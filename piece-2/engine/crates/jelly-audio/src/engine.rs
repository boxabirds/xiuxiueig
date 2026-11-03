//! The jelly asteroids sound engine (owner brief: "smooth drone, pitch as a
//! function of the size of the jelly (with some harmonic variation), squishes
//! and water drop plops").
//!
//! Zero heap allocation: every buffer is an inline fixed-size array, and
//! `render()` and `apply_params()` allocate nothing (tests/no_alloc.rs).

use core::f32::consts::{FRAC_PI_4, TAU};

use xiu_dsp::chorus::{ChorusMode, StereoChorus};
use xiu_dsp::filter::HighPass;
use xiu_dsp::math::fast_tanh;

use crate::params::*;

pub const BLOCK_FRAMES: usize = 128;
pub const CHANNELS: usize = 2;
pub const OUTPUT_LEN: usize = BLOCK_FRAMES * CHANNELS;

// ── sine table ──────────────────────────────────────────────────────────
const SINE_SIZE: usize = 2048;

// ── drone voices ────────────────────────────────────────────────────────
const PARTIALS: usize = 4;
/// Harmonic recipes (relative amplitude of partials 1..4). Each voice uses one:
/// the "harmonic variation" between jellies.
const RECIPES: [[f32; PARTIALS]; 4] = [
    [1.0, 0.35, 0.12, 0.05],  // round
    [1.0, 0.10, 0.30, 0.02],  // hollow (odd)
    [1.0, 0.50, 0.25, 0.15],  // bright
    [1.0, 0.20, 0.05, 0.12],  // bell-ish fourth
];
const PARTIAL_RATIOS: [f32; PARTIALS] = [1.0, 2.0, 3.0, 4.0];
const TWIN_DETUNE_CENTS: f32 = 6.0;       // a slow-beating twin of the fundamental
const TWIN_LEVEL: f32 = 0.45;
const PARTIAL_DRIFT_HZ: f32 = 0.07;       // partial balance breathes slowly
const PARTIAL_DRIFT_DEPTH: f32 = 0.35;
const FREQ_GLIDE_S: f32 = 0.6;            // a merge slides the pitch down
const GAIN_GLIDE_S: f32 = 0.35;
const PAN_GLIDE_S: f32 = 0.25;
const VOICE_LEVEL: f32 = 0.15;
const BREATH_FLOOR: f32 = 0.7;
const CENTS_PER_OCTAVE: f32 = 1200.0;

// ── squish ──────────────────────────────────────────────────────────────
// A soft, rounded "goo" tone: owner feedback was that the first version (noise
// through randomly jumping formants) sounded like harsh record scratching.
// No noise, no random jumps: a sine with a little second harmonic, low-passed,
// sagging in pitch as it is pressed, with a very gentle vibrato.
const SQUISH_ATTACK_S: f32 = 0.08;
const SQUISH_RELEASE_S: f32 = 0.45;
const SQUISH_PITCH_GLIDE_S: f32 = 0.15;
const SQUISH_DROOP: f32 = 0.25;           // pitch sags by up to 25% as it is pressed
const SQUISH_VIBRATO_HZ: f32 = 5.0;
const SQUISH_VIBRATO_CENTS: f32 = 8.0;    // owner: "a very gentle vibrato is fine"
const SQUISH_H2: f32 = 0.3;
const SQUISH_LP_HZ: f32 = 1200.0;
const SQUISH_GAIN: f32 = 0.5;
const SQUISH_CURVE: f32 = 1.5;
const SQUISH_PITCH_MIN: f32 = 60.0;
const SQUISH_PITCH_MAX: f32 = 1200.0;

// ── plops ───────────────────────────────────────────────────────────────
const PLOPS: usize = 8;
const PLOP_RISE: f32 = 0.9;               // pitch rises by +90% (bubble resonance chirp)
const PLOP_RISE_S: f32 = 0.025;
const PLOP_ATTACK_S: f32 = 0.004;      // soft onset: no click
const PLOP_DECAY_MIN_S: f32 = 0.035;
const PLOP_DECAY_SLOPE: f32 = 0.025;       // seconds less ring per kHz: lower drops ring longer
const HZ_PER_KHZ: f32 = 1000.0;
const PLOP_DECAY_MAX_S: f32 = 0.1;
const PLOP_LEVEL: f32 = 1.0;
const PLOP_PITCH_MIN: f32 = 150.0;
const PLOP_PITCH_MAX: f32 = 3000.0;
const PLOP_SILENT: f32 = 1e-4;

// ── output ──────────────────────────────────────────────────────────────
const CHORUS_MIX: f32 = 0.25;
const DC_BLOCK_HZ: f32 = 20.0;
const OUTPUT_DRIVE: f32 = 1.6;
const OUTPUT_CEILING: f32 = 0.89;
const MASTER_GLIDE_S: f32 = 0.05;

#[inline(always)]
fn coeff(seconds: f32, rate: f32) -> f32 {
    1.0 - (-1.0 / (seconds * rate)).exp()
}

#[inline(always)]
fn equal_power(pan: f32) -> (f32, f32) {
    let a = (pan.clamp(-1.0, 1.0) + 1.0) * FRAC_PI_4;
    (a.cos(), a.sin())
}

struct Sine {
    table: [f32; SINE_SIZE + 1],
}

impl Sine {
    fn new() -> Self {
        let mut table = [0.0; SINE_SIZE + 1];
        for (i, v) in table.iter_mut().enumerate() {
            *v = (i as f32 / SINE_SIZE as f32 * TAU).sin();
        }
        Self { table }
    }
    /// phase in [0, 1)
    #[inline(always)]
    fn at(&self, phase: f32) -> f32 {
        let x = phase * SINE_SIZE as f32;
        let i = x as usize;
        let f = x - i as f32;
        let a = self.table[i & (SINE_SIZE - 1)];
        let b = self.table[(i & (SINE_SIZE - 1)) + 1];
        a + (b - a) * f
    }
}

#[inline(always)]
fn advance(phase: &mut f32, inc: f32) {
    *phase += inc;
    if *phase >= 1.0 { *phase -= (*phase).floor(); }
}

struct Voice {
    phases: [f32; PARTIALS],
    twin_phase: f32,
    freq: f32,
    gain: f32,
    pan: f32,
    recipe: usize,
    drift_phase: f32,
}

struct Plop {
    phase: f32,
    t: f32,
    f0: f32,
    decay: f32,
    gain: f32,
    pan: f32,
    active: bool,
}

pub struct Engine {
    sine: Sine,
    voices: [Voice; VOICES],
    plops: [Plop; PLOPS],
    next_plop: usize,
    last_plop_count: f32,
    squish_env: f32,
    squish_pitch: f32,
    squish_phase: f32,
    squish_phase2: f32,
    squish_vib_phase: f32,
    squish_lp: f32,
    chorus_l: StereoChorus,
    chorus_r: StereoChorus,
    dc_l: HighPass,
    dc_r: HighPass,
    params: [f32; PARAM_COUNT],
    master: f32,
    sample_rate: f32,
    inv_sr: f32,
    k_freq: f32,
    k_gain: f32,
    k_pan: f32,
    k_master: f32,
    k_attack: f32,
    k_release: f32,
    k_squish_pitch: f32,
    lp_squish: f32,
    twin_ratio: f32,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        let mut chorus_l = StereoChorus::new(sample_rate);
        let mut chorus_r = StereoChorus::new(sample_rate);
        chorus_l.mode = ChorusMode::Mode1;
        chorus_r.mode = ChorusMode::Mode1;
        chorus_l.mix = CHORUS_MIX;
        chorus_r.mix = CHORUS_MIX;
        let mut dc_l = HighPass::new(sample_rate);
        let mut dc_r = HighPass::new(sample_rate);
        dc_l.set_cutoff(DC_BLOCK_HZ);
        dc_r.set_cutoff(DC_BLOCK_HZ);
        let mut params = [0.0; PARAM_COUNT];
        for v in 0..VOICES { params[v * PER_VOICE + V_FREQ] = 110.0; }
        params[P_SQUISH_PITCH] = 200.0;
        params[P_PLOP_PITCH] = 800.0;
        Self {
            sine: Sine::new(),
            voices: core::array::from_fn(|i| Voice {
                phases: [0.0; PARTIALS], twin_phase: 0.0, freq: 110.0, gain: 0.0, pan: 0.0,
                recipe: i % RECIPES.len(), drift_phase: i as f32 * 0.137,
            }),
            plops: core::array::from_fn(|_| Plop { phase: 0.0, t: 0.0, f0: 800.0, decay: 0.1, gain: 0.0, pan: 0.0, active: false }),
            next_plop: 0,
            last_plop_count: 0.0,
            squish_env: 0.0,
            squish_pitch: 200.0,
            squish_phase: 0.0,
            squish_phase2: 0.0,
            squish_vib_phase: 0.0,
            squish_lp: 0.0,
            chorus_l, chorus_r, dc_l, dc_r,
            params,
            master: 0.0,
            sample_rate,
            inv_sr: 1.0 / sample_rate,
            k_freq: coeff(FREQ_GLIDE_S, sample_rate),
            k_gain: coeff(GAIN_GLIDE_S, sample_rate),
            k_pan: coeff(PAN_GLIDE_S, sample_rate),
            k_master: coeff(MASTER_GLIDE_S, sample_rate),
            k_attack: coeff(SQUISH_ATTACK_S, sample_rate),
            k_release: coeff(SQUISH_RELEASE_S, sample_rate),
            k_squish_pitch: coeff(SQUISH_PITCH_GLIDE_S, sample_rate),
            lp_squish: 1.0 - (-TAU * SQUISH_LP_HZ / sample_rate).exp(),
            twin_ratio: (TWIN_DETUNE_CENTS / CENTS_PER_OCTAVE).exp2(),
        }
    }

    pub fn apply_params(&mut self, raw: &[f32; PARAM_COUNT]) {
        for v in 0..VOICES {
            let b = v * PER_VOICE;
            self.params[b + V_FREQ] = sanitize(raw[b + V_FREQ], FREQ_MIN, FREQ_MAX);
            self.params[b + V_GAIN] = sanitize(raw[b + V_GAIN], 0.0, 1.0);
            self.params[b + V_PAN] = sanitize(raw[b + V_PAN], -1.0, 1.0);
        }
        self.params[P_MASTER] = sanitize(raw[P_MASTER], 0.0, 1.0);
        self.params[P_BREATH] = sanitize(raw[P_BREATH], 0.0, 1.0);
        self.params[P_SQUISH] = sanitize(raw[P_SQUISH], 0.0, 1.0);
        self.params[P_SQUISH_PITCH] = sanitize(raw[P_SQUISH_PITCH], SQUISH_PITCH_MIN, SQUISH_PITCH_MAX);
        self.params[P_SQUISH_PAN] = sanitize(raw[P_SQUISH_PAN], -1.0, 1.0);
        self.params[P_PLOP_PITCH] = sanitize(raw[P_PLOP_PITCH], PLOP_PITCH_MIN, PLOP_PITCH_MAX);
        self.params[P_PLOP_PAN] = sanitize(raw[P_PLOP_PAN], -1.0, 1.0);
        self.params[P_PLOP_GAIN] = sanitize(raw[P_PLOP_GAIN], 0.0, 1.0);
        let count = if raw[P_PLOP_COUNT].is_finite() { raw[P_PLOP_COUNT] } else { self.last_plop_count };
        // Each increment of the counter is one plop (capped so a jump cannot flood the pool).
        let new = (count - self.last_plop_count).clamp(0.0, PLOPS as f32) as usize;
        for _ in 0..new { self.trigger_plop(); }
        self.last_plop_count = count;
    }

    fn trigger_plop(&mut self) {
        let f0 = self.params[P_PLOP_PITCH];
        let p = &mut self.plops[self.next_plop];
        self.next_plop = (self.next_plop + 1) % PLOPS;
        p.phase = 0.0;
        p.t = 0.0;
        p.f0 = f0;
        p.decay = (PLOP_DECAY_MAX_S - PLOP_DECAY_SLOPE * f0 / HZ_PER_KHZ).clamp(PLOP_DECAY_MIN_S, PLOP_DECAY_MAX_S);
        p.gain = self.params[P_PLOP_GAIN];
        p.pan = self.params[P_PLOP_PAN];
        p.active = true;
    }

    /// Introspection for tests: voice i's current (glided) frequency.
    pub fn voice_frequency(&self, i: usize) -> f32 {
        self.voices[i % VOICES].freq
    }

    pub fn render(&mut self, out: &mut [f32; OUTPUT_LEN]) {
        let inv_sr = self.inv_sr;
        let breath_gain = BREATH_FLOOR + (1.0 - BREATH_FLOOR) * self.params[P_BREATH];
        let squish_target = self.params[P_SQUISH].powf(SQUISH_CURVE);
        let squish_pitch = self.params[P_SQUISH_PITCH];
        let (sq_l, sq_r) = equal_power(self.params[P_SQUISH_PAN]);
        let vib_ratio_depth = SQUISH_VIBRATO_CENTS / CENTS_PER_OCTAVE;

        for frame in 0..BLOCK_FRAMES {
            let mut left = 0.0f32;
            let mut right = 0.0f32;

            // Drone voices.
            for (i, v) in self.voices.iter_mut().enumerate() {
                let b = i * PER_VOICE;
                v.freq += self.k_freq * (self.params[b + V_FREQ] - v.freq);
                v.gain += self.k_gain * (self.params[b + V_GAIN] - v.gain);
                v.pan += self.k_pan * (self.params[b + V_PAN] - v.pan);
                if v.gain < PLOP_SILENT { continue; }
                advance(&mut v.drift_phase, PARTIAL_DRIFT_HZ * inv_sr);
                let drift = self.sine.at(v.drift_phase) * PARTIAL_DRIFT_DEPTH;
                let recipe = &RECIPES[v.recipe];
                let mut s = 0.0;
                for k in 0..PARTIALS {
                    advance(&mut v.phases[k], v.freq * PARTIAL_RATIOS[k] * inv_sr);
                    let w = if k == 0 { recipe[0] } else { recipe[k] * (1.0 + drift * if k % 2 == 0 { 1.0 } else { -1.0 }) };
                    s += self.sine.at(v.phases[k]) * w;
                }
                advance(&mut v.twin_phase, v.freq * self.twin_ratio * inv_sr);
                s += self.sine.at(v.twin_phase) * TWIN_LEVEL;
                s *= v.gain * VOICE_LEVEL * breath_gain;
                let (gl, gr) = equal_power(v.pan);
                left += s * gl;
                right += s * gr;
            }

            // Squish: a soft goo tone that swells, sags in pitch and breathes a little.
            let env_k = if squish_target > self.squish_env { self.k_attack } else { self.k_release };
            self.squish_env += env_k * (squish_target - self.squish_env);
            self.squish_pitch += self.k_squish_pitch * (squish_pitch - self.squish_pitch);
            if self.squish_env > PLOP_SILENT {
                advance(&mut self.squish_vib_phase, SQUISH_VIBRATO_HZ * inv_sr);
                let vib = (self.sine.at(self.squish_vib_phase) * vib_ratio_depth).exp2();
                let f = self.squish_pitch * (1.0 - SQUISH_DROOP * self.squish_env) * vib;
                advance(&mut self.squish_phase, f * inv_sr);
                advance(&mut self.squish_phase2, 2.0 * f * inv_sr);
                let tone = self.sine.at(self.squish_phase) + SQUISH_H2 * self.sine.at(self.squish_phase2);
                self.squish_lp += self.lp_squish * (tone - self.squish_lp);
                let s = self.squish_lp * self.squish_env * SQUISH_GAIN;
                left += s * sq_l;
                right += s * sq_r;
            }

            // Plops: a soft-onset bubble resonance whose pitch rises (a water drop).
            for p in self.plops.iter_mut() {
                if !p.active { continue; }
                let f = p.f0 * (1.0 + PLOP_RISE * (1.0 - (-p.t / PLOP_RISE_S).exp()));
                advance(&mut p.phase, f * inv_sr);
                let attack = (p.t / PLOP_ATTACK_S).min(1.0);
                let env = attack * (-p.t / p.decay).exp();
                let s = self.sine.at(p.phase) * env * p.gain * PLOP_LEVEL;
                let (gl, gr) = equal_power(p.pan);
                left += s * gl;
                right += s * gr;
                p.t += inv_sr;
                if p.t > PLOP_ATTACK_S && env < PLOP_SILENT { p.active = false; }
            }

            let (wl, _) = self.chorus_l.tick(left);
            let (_, wr) = self.chorus_r.tick(right);
            self.master += self.k_master * (self.params[P_MASTER] - self.master);
            out[frame * CHANNELS] = fast_tanh(self.dc_l.tick(wl) * self.master * OUTPUT_DRIVE) * OUTPUT_CEILING;
            out[frame * CHANNELS + 1] = fast_tanh(self.dc_r.tick(wr) * self.master * OUTPUT_DRIVE) * OUTPUT_CEILING;
        }
    }
}

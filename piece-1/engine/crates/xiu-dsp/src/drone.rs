//! The xiuxiueig drone: no notes and no triggered envelopes, only continuous
//! voices that glide between glass partials. Rare glint swells ring a
//! wine-glass modal body, and everything passes through a BBD chorus. See
//! docs/design/brief.md, section "Sound".
//!
//! Zero heap allocation: every buffer is an inline fixed-size array, and
//! `render()` does no allocation of any kind (enforced by tests/no_alloc.rs).

use core::f32::consts::FRAC_PI_4;

use crate::benjolin::Benjolin;
use crate::chorus::{ChorusMode, StereoChorus};
use crate::filter::{HighPass, IR3109};
use crate::math::fast_tanh;
use crate::glint::GlintField;
use crate::modal::GLASS;
use crate::oscillator::{NoiseGen, Oscillator};
use crate::params::*;

pub const BLOCK_FRAMES: usize = 128;
pub const CHANNELS: usize = 2;
pub const OUTPUT_LEN: usize = BLOCK_FRAMES * CHANNELS;

// ── Voices ──────────────────────────────────────────────────────────────
const VOICE_COUNT: usize = 6;
const ROOT_HZ: f32 = 41.0;
const VOICE_OCTAVES: [f32; VOICE_COUNT] = [1.0, 1.0, 2.0, 2.0, 4.0, 4.0];
const VOICE_PANS: [f32; VOICE_COUNT] = [-0.9, 0.7, -0.4, 0.95, -0.75, 0.3];
const VOICE_LEVELS: [f32; VOICE_COUNT] = [0.30, 0.27, 0.21, 0.19, 0.12, 0.10];
const VOICE_WOBBLE: [usize; VOICE_COUNT] = [0, 1, 2, 0, 1, 2];
const VOICE_CHAOS_SIGN: [f32; VOICE_COUNT] = [1.0, -1.0, 0.6, -0.6, 1.0, -1.0];

/// Indices into the GLASS mode table whose ratios lie in 1.0–4.15:
/// 1.0, 1.58, 1.85, 2.1, 2.32, 3.24, 3.78, 4.15. These are inharmonic, so
/// there is no tonal centre.
const PARTIAL_INDICES: [usize; 8] = [0, 8, 16, 24, 1, 9, 17, 2];

const SAW: u8 = 1;
const OSC_PORTAMENTO_S: f32 = 0.03;
const OSC_DRIFT: f32 = 0.6;
const RATIO_GLIDE_S: f32 = 6.0;
const RETARGET_MIN_S: f32 = 11.0;
const RETARGET_RANGE_S: f32 = 19.0;
const RETARGET_STAGGER_S: f32 = 3.7;

const DETUNE_BASE_CENTS: f32 = 4.0;
const DETUNE_MISREG_CENTS: f32 = 28.0;
const PITCH_WOBBLE_CENTS: f32 = 9.0;
const CENTS_PER_OCTAVE: f32 = 1200.0;

const BREATH_LEVEL_FLOOR: f32 = 0.35;
const AMP_WOBBLE_DEPTH: f32 = 0.35;

const CUTOFF_MIN_HZ: f32 = 90.0;
const CUTOFF_BREATH_OCTAVES: f32 = 2.2;
const CUTOFF_ALTITUDE_OCTAVES: f32 = 2.6;
const CUTOFF_WOBBLE_OCTAVES: f32 = 0.6;
const CUTOFF_CHAOS_OCTAVES: f32 = 1.8;
const CUTOFF_DENSITY_OCTAVES: f32 = 1.4; // thick jelly absorbs highs: darker
const CUTOFF_UPDATE_INTERVAL: usize = 16;
/// Era root: slow transposition across this many semitones, centred.
const ERA_ROOT_SEMITONES: f32 = 7.0;
const SEMITONES_PER_OCTAVE: f32 = 12.0;
const FILTER_RESONANCE: f32 = 0.35;

// ── Chaos ───────────────────────────────────────────────────────────────
const BENJOLIN_RATE_1_HZ: f32 = 2.3;
const BENJOLIN_RATE_2_HZ: f32 = 3.7;
const BENJOLIN_DEPTH_MIN: f32 = 0.15;

// ── Glints ──────────────────────────────────────────────────────────────
// Level set against tests/glints.rs: audible, but under the drone.
const GLINT_GAIN: f32 = 1.2;

// ── Output ──────────────────────────────────────────────────────────────
const CHORUS_MIX_MIN: f32 = 0.2;
const CHORUS_MIX_RANGE: f32 = 0.5;
const DC_BLOCK_HZ: f32 = 20.0;
const OUTPUT_DRIVE: f32 = 3.5;
const OUTPUT_CEILING: f32 = 0.89;
const MASTER_SMOOTH_S: f32 = 0.05;
const NOISE_SEED: u32 = 0x5EED_1E55;

#[inline(always)]
fn cents_to_ratio(cents: f32) -> f32 {
    (cents / CENTS_PER_OCTAVE).exp2()
}

/// One-pole smoothing coefficient that reaches ~63% in `seconds`.
#[inline(always)]
fn smoothing_coeff(seconds: f32, rate_hz: f32) -> f32 {
    1.0 - (-1.0 / (seconds * rate_hz)).exp()
}

struct DroneVoice {
    osc_a: Oscillator,
    osc_b: Oscillator,
    filter: IR3109,
    ratio: f32,
    ratio_target: f32,
    retarget_in: f32,
    amp: f32,
    gain_l: f32,
    gain_r: f32,
    cutoff_octaves: f32,
}

impl DroneVoice {
    fn new(index: usize, sample_rate: f32) -> Self {
        let ratio = GLASS[PARTIAL_INDICES[index % PARTIAL_INDICES.len()]].0;
        let mut osc_a = Oscillator::new();
        let mut osc_b = Oscillator::new();
        osc_a.set_portamento(OSC_PORTAMENTO_S, sample_rate);
        osc_b.set_portamento(OSC_PORTAMENTO_S, sample_rate);
        let hz = ROOT_HZ * VOICE_OCTAVES[index] * ratio;
        osc_a.set_freq_immediate(hz, OSC_DRIFT);
        osc_b.set_freq_immediate(hz, OSC_DRIFT);
        let mut filter = IR3109::new(sample_rate);
        filter.resonance = FILTER_RESONANCE;
        Self {
            osc_a,
            osc_b,
            filter,
            ratio,
            ratio_target: ratio,
            retarget_in: (RETARGET_MIN_S + index as f32 * RETARGET_STAGGER_S) * sample_rate,
            amp: 0.0,
            gain_l: 0.0,
            gain_r: 0.0,
            cutoff_octaves: 0.0,
        }
    }
}

pub struct Engine {
    voices: [DroneVoice; VOICE_COUNT],
    benjolin: Benjolin,
    glints: GlintField,
    chorus_l: StereoChorus,
    chorus_r: StereoChorus,
    dc_l: HighPass,
    dc_r: HighPass,
    rng: NoiseGen,
    params: [f32; PARAM_COUNT],
    chaos_depth: f32,
    master: f32,
    master_target: f32,
    master_coeff: f32,
    ratio_coeff: f32,
    sample_rate: f32,
    inv_sr: f32,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        let mut chorus_l = StereoChorus::new(sample_rate);
        let mut chorus_r = StereoChorus::new(sample_rate);
        chorus_l.mode = ChorusMode::Mode12;
        chorus_r.mode = ChorusMode::Mode12;
        let mut dc_l = HighPass::new(sample_rate);
        let mut dc_r = HighPass::new(sample_rate);
        dc_l.set_cutoff(DC_BLOCK_HZ);
        dc_r.set_cutoff(DC_BLOCK_HZ);
        let block_rate = sample_rate / BLOCK_FRAMES as f32;
        Self {
            voices: core::array::from_fn(|i| DroneVoice::new(i, sample_rate)),
            benjolin: Benjolin::new(),
            glints: GlintField::new(sample_rate),
            chorus_l,
            chorus_r,
            dc_l,
            dc_r,
            rng: NoiseGen::new(NOISE_SEED),
            params: [0.0; PARAM_COUNT],
            chaos_depth: BENJOLIN_DEPTH_MIN,
            master: 0.0,
            master_target: 0.0,
            master_coeff: smoothing_coeff(MASTER_SMOOTH_S, sample_rate),
            ratio_coeff: smoothing_coeff(RATIO_GLIDE_S, block_rate),
            sample_rate,
            inv_sr: 1.0 / sample_rate,
        }
    }

    /// Copy and sanitise a full parameter block (see `params.rs`).
    pub fn apply_params(&mut self, raw: &[f32; PARAM_COUNT]) {
        for (i, value) in raw.iter().enumerate() {
            let (min, max) = if WOBBLE_PARAMS.contains(&i) { (-1.0, 1.0) } else { (0.0, 1.0) };
            self.params[i] = sanitize(*value, min, max);
        }
    }

    fn rand01(&mut self) -> f32 {
        (self.rng.next() + 1.0) * 0.5
    }

    fn update_block(&mut self) {
        let p = self.params;
        let breath = p[P_BREATH];
        let misreg = p[P_MISREG];
        let spread = p[P_SPREAD];
        let detune = cents_to_ratio(DETUNE_BASE_CENTS + misreg * DETUNE_MISREG_CENTS);
        let era_root = ((p[P_ERA_ROOT] - 0.5) * ERA_ROOT_SEMITONES / SEMITONES_PER_OCTAVE).exp2();

        for i in 0..VOICE_COUNT {
            let retarget = {
                let v = &mut self.voices[i];
                v.retarget_in -= BLOCK_FRAMES as f32;
                v.retarget_in <= 0.0
            };
            if retarget {
                let pick = (self.rand01() * PARTIAL_INDICES.len() as f32) as usize;
                let wait = RETARGET_MIN_S + self.rand01() * RETARGET_RANGE_S;
                let v = &mut self.voices[i];
                v.ratio_target = GLASS[PARTIAL_INDICES[pick.min(PARTIAL_INDICES.len() - 1)]].0;
                v.retarget_in = wait * self.sample_rate;
            }

            let wobble = p[WOBBLE_PARAMS[VOICE_WOBBLE[i]]];
            let v = &mut self.voices[i];
            v.ratio += self.ratio_coeff * (v.ratio_target - v.ratio);
            let hz = ROOT_HZ * era_root * VOICE_OCTAVES[i] * v.ratio * cents_to_ratio(wobble * PITCH_WOBBLE_CENTS);
            v.osc_a.set_freq(hz, OSC_DRIFT);
            v.osc_b.set_freq(hz * detune, OSC_DRIFT);

            v.amp = VOICE_LEVELS[i]
                * (BREATH_LEVEL_FLOOR + (1.0 - BREATH_LEVEL_FLOOR) * breath)
                * (1.0 + AMP_WOBBLE_DEPTH * wobble);
            v.cutoff_octaves = breath * CUTOFF_BREATH_OCTAVES
                + p[P_ALTITUDE] * CUTOFF_ALTITUDE_OCTAVES
                + wobble * CUTOFF_WOBBLE_OCTAVES
                - p[P_ERA_DENSITY] * CUTOFF_DENSITY_OCTAVES;

            let pan = VOICE_PANS[i] * spread;
            let angle = (pan + 1.0) * FRAC_PI_4;
            v.gain_l = angle.cos();
            v.gain_r = angle.sin();
        }

        self.chaos_depth = BENJOLIN_DEPTH_MIN + (1.0 - BENJOLIN_DEPTH_MIN) * p[P_AGITATION];
        self.benjolin.set_params(BENJOLIN_RATE_1_HZ, BENJOLIN_RATE_2_HZ, self.chaos_depth);

        self.glints.set_density(p[P_CONVERGENCE]);

        let chorus_mix = CHORUS_MIX_MIN + CHORUS_MIX_RANGE * misreg;
        self.chorus_l.mix = chorus_mix;
        self.chorus_r.mix = chorus_mix;
        self.master_target = p[P_MASTER];
    }

    /// Introspection for tests and diagnostics: voice `i`'s current base frequency.
    pub fn voice_frequency(&self, i: usize) -> f32 {
        self.voices[i % VOICE_COUNT].osc_a.freq
    }

    /// Render one block of interleaved stereo into `out`. Allocation-free.
    pub fn render(&mut self, out: &mut [f32; OUTPUT_LEN]) {
        self.update_block();
        let inv_sr = self.inv_sr;
        for frame in 0..BLOCK_FRAMES {
            let chaos = self.benjolin.tick(inv_sr);
            let refresh_cutoff = frame % CUTOFF_UPDATE_INTERVAL == 0;
            let mut left = 0.0f32;
            let mut right = 0.0f32;
            for (i, v) in self.voices.iter_mut().enumerate() {
                if refresh_cutoff {
                    let octaves = v.cutoff_octaves
                        + chaos * self.chaos_depth * CUTOFF_CHAOS_OCTAVES * VOICE_CHAOS_SIGN[i];
                    v.filter.set_cutoff(CUTOFF_MIN_HZ * octaves.exp2());
                }
                let raw = (v.osc_a.tick(inv_sr, SAW) + v.osc_b.tick(inv_sr, SAW)) * 0.5;
                let s = v.filter.tick(raw) * v.amp;
                left += s * v.gain_l;
                right += s * v.gain_r;
            }

            let glint = self.glints.tick() * GLINT_GAIN;
            left += glint;
            right += glint;

            let (wet_l, _) = self.chorus_l.tick(left);
            let (_, wet_r) = self.chorus_r.tick(right);

            self.master += self.master_coeff * (self.master_target - self.master);
            let l = self.dc_l.tick(wet_l) * self.master * OUTPUT_DRIVE;
            let r = self.dc_r.tick(wet_r) * self.master * OUTPUT_DRIVE;
            out[frame * CHANNELS] = fast_tanh(l) * OUTPUT_CEILING;
            out[frame * CHANNELS + 1] = fast_tanh(r) * OUTPUT_CEILING;
        }
    }
}

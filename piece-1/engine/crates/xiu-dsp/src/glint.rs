//! Glints: rare, soft swells of light-as-sound (brief, "Sound").
//!
//! Replaces the first version (JP-8 Minnaert bubbles), which the owner found
//! "really annoying chirping". Each bubble was a short sine at a random pitch,
//! up to 16 per second. Now each glint is a slow raised-cosine noise swell
//! that excites the JP-8 wine-glass modal body. The pitch comes from the glass
//! modes (consistent and inharmonic, never random), and nothing has an attack.
//! The swell's brightness varies, so different glints ring different modes.
//!
//! Allocation-free: fixed state only.

use crate::modal::ModalResonator;
use crate::oscillator::NoiseGen;

const RATE_MIN_HZ: f32 = 0.12;
const RATE_MAX_HZ: f32 = 2.2;
const SWELL_MIN_S: f32 = 0.08;
const SWELL_RANGE_S: f32 = 0.08;
const BRIGHTNESS_MIN_HZ: f32 = 500.0;
const BRIGHTNESS_RANGE_HZ: f32 = 2200.0;
const BODY_PRESET: u8 = 4; // wine glass
const BODY_MATERIAL: f32 = 0.8;
const BODY_MODES: u8 = 12;
const BODY_INHARMONICITY: f32 = 0.3;
const BODY_HZ: f32 = 392.0;
const MIN_RANDOM: f32 = 1e-4;
const SEED: u32 = 0x611_7715;

pub struct GlintField {
    body: ModalResonator,
    rng: NoiseGen,
    sample_rate: f32,
    inv_sr: f32,
    rate_hz: f32,
    until_next: f32, // samples
    swell_pos: f32,  // samples into the current swell
    swell_len: f32,  // samples; 0 = idle
    lp_coeff: f32,
    lp_state: f32,
}

impl GlintField {
    pub fn new(sample_rate: f32) -> Self {
        let mut body = ModalResonator::new(sample_rate);
        body.set_params(BODY_PRESET, BODY_MATERIAL, BODY_MODES, BODY_INHARMONICITY, BODY_HZ);
        let mut g = Self {
            body,
            rng: NoiseGen::new(SEED),
            sample_rate,
            inv_sr: 1.0 / sample_rate,
            rate_hz: RATE_MIN_HZ,
            until_next: 0.0,
            swell_pos: 0.0,
            swell_len: 0.0,
            lp_coeff: 0.0,
            lp_state: 0.0,
        };
        g.schedule();
        g
    }

    /// `density` 0..1 (caustic convergence).
    pub fn set_density(&mut self, density: f32) {
        let rate = RATE_MIN_HZ + (RATE_MAX_HZ - RATE_MIN_HZ) * density.clamp(0.0, 1.0);
        // Poisson waits are memoryless: rescale the pending wait to the new rate,
        // otherwise a wait drawn at the minimum rate ignores rising density.
        self.until_next *= self.rate_hz / rate;
        self.rate_hz = rate;
    }

    fn rand01(&mut self) -> f32 {
        (self.rng.next() + 1.0) * 0.5
    }

    /// Poisson spacing: exponential wait at the current rate.
    fn schedule(&mut self) {
        let u = self.rand01().max(MIN_RANDOM);
        self.until_next = -u.ln() / self.rate_hz * self.sample_rate;
    }

    fn start_swell(&mut self) {
        self.swell_len = (SWELL_MIN_S + self.rand01() * SWELL_RANGE_S) * self.sample_rate;
        self.swell_pos = 0.0;
        let cutoff = BRIGHTNESS_MIN_HZ + self.rand01() * BRIGHTNESS_RANGE_HZ;
        self.lp_coeff = 1.0 - (-core::f32::consts::TAU * cutoff * self.inv_sr).exp();
    }

    #[inline(always)]
    pub fn tick(&mut self) -> f32 {
        self.until_next -= 1.0;
        if self.until_next <= 0.0 {
            if self.swell_len == 0.0 {
                self.start_swell();
            }
            self.schedule();
        }
        let mut excite = 0.0;
        if self.swell_len > 0.0 {
            let phase = self.swell_pos / self.swell_len;
            let env = 0.5 - 0.5 * (core::f32::consts::TAU * phase).cos(); // raised cosine
            excite = self.rng.next() * env;
            self.swell_pos += 1.0;
            if self.swell_pos >= self.swell_len {
                self.swell_len = 0.0;
            }
        }
        self.lp_state += self.lp_coeff * (excite - self.lp_state);
        self.body.tick(self.lp_state)
    }
}

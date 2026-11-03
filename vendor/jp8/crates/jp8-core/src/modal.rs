/// Modal resonator — parallel bank of biquad bandpass filters.
/// Models the resonant modes of a vibrating body.
/// Each mode is a 2nd-order bandpass filter (6 ops/sample).
///
/// 5 body presets with frequency ratios and decay profiles
/// derived from material physics and seed sample characteristics.

const MAX_MODES: usize = 32;

/// (frequency_ratio, relative_amplitude, decay_multiplier)
/// Frequency ratios are relative to a 440Hz fundamental.
/// Decay multiplier scales the base Q for each mode.
type ModeData = (f32, f32, f32);

/// Body preset: array of mode data + mode count
struct BodyPreset {
    modes: &'static [ModeData],
}

// Preset 0: Metal Bar — nearly harmonic with slight inharmonicity, long decay
const METAL_BAR: &[ModeData] = &[
    (1.0, 1.0, 1.0), (2.76, 0.7, 0.9), (5.40, 0.5, 0.8), (8.93, 0.35, 0.7),
    (13.34, 0.25, 0.6), (18.64, 0.18, 0.5), (24.84, 0.12, 0.45), (31.91, 0.08, 0.4),
    (1.5, 0.4, 0.85), (3.5, 0.3, 0.75), (6.8, 0.22, 0.65), (10.5, 0.15, 0.55),
    (15.0, 0.1, 0.5), (20.0, 0.07, 0.45), (26.0, 0.05, 0.4), (33.0, 0.03, 0.35),
    (2.0, 0.5, 0.88), (4.2, 0.35, 0.78), (7.5, 0.25, 0.68), (11.8, 0.17, 0.58),
    (16.5, 0.12, 0.48), (22.0, 0.08, 0.43), (28.5, 0.05, 0.38), (35.5, 0.03, 0.33),
    (2.3, 0.45, 0.82), (4.8, 0.3, 0.72), (8.2, 0.2, 0.62), (12.5, 0.14, 0.52),
    (17.8, 0.09, 0.47), (23.5, 0.06, 0.42), (30.0, 0.04, 0.37), (37.0, 0.02, 0.32),
];

// Preset 1: Metal Tube — hollow, tubular harmonics with formant-like clustering
const METAL_TUBE: &[ModeData] = &[
    (1.0, 1.0, 1.0), (2.0, 0.8, 0.95), (3.0, 0.6, 0.85), (4.0, 0.45, 0.75),
    (5.0, 0.3, 0.65), (6.0, 0.2, 0.55), (7.0, 0.14, 0.5), (8.0, 0.1, 0.45),
    (1.3, 0.5, 0.9), (2.6, 0.4, 0.8), (3.9, 0.3, 0.7), (5.2, 0.2, 0.6),
    (6.5, 0.14, 0.52), (7.8, 0.1, 0.47), (9.1, 0.07, 0.42), (10.4, 0.05, 0.37),
    (1.6, 0.45, 0.88), (3.2, 0.35, 0.78), (4.8, 0.25, 0.68), (6.4, 0.17, 0.58),
    (8.0, 0.12, 0.48), (9.6, 0.08, 0.43), (11.2, 0.05, 0.38), (12.8, 0.03, 0.33),
    (2.3, 0.35, 0.82), (4.6, 0.25, 0.72), (6.9, 0.17, 0.62), (9.2, 0.11, 0.52),
    (11.5, 0.07, 0.47), (13.8, 0.05, 0.42), (16.1, 0.03, 0.37), (18.4, 0.02, 0.32),
];

// Preset 2: Glass — sparse, high-Q modes with wide spacing (inharmonic)
const GLASS: &[ModeData] = &[
    (1.0, 1.0, 1.0), (2.32, 0.8, 0.95), (4.15, 0.6, 0.88), (6.58, 0.4, 0.8),
    (9.62, 0.25, 0.7), (13.27, 0.15, 0.6), (17.53, 0.1, 0.5), (22.40, 0.06, 0.4),
    (1.58, 0.6, 0.92), (3.24, 0.45, 0.84), (5.42, 0.3, 0.75), (8.12, 0.2, 0.65),
    (11.44, 0.12, 0.55), (15.37, 0.07, 0.47), (19.91, 0.04, 0.4), (25.06, 0.03, 0.33),
    (1.85, 0.5, 0.9), (3.78, 0.35, 0.82), (6.0, 0.23, 0.72), (8.9, 0.15, 0.62),
    (12.5, 0.09, 0.52), (16.8, 0.05, 0.44), (21.7, 0.03, 0.36), (27.3, 0.02, 0.3),
    (2.1, 0.4, 0.87), (4.5, 0.28, 0.77), (7.3, 0.18, 0.67), (10.8, 0.11, 0.57),
    (14.9, 0.07, 0.49), (19.6, 0.04, 0.41), (25.0, 0.02, 0.34), (31.0, 0.01, 0.28),
];

// Preset 3: Tubular Bell — classic bell partials (1, 2, 3, 4.16, 5.43, 6.79...)
const BELL: &[ModeData] = &[
    (1.0, 1.0, 1.0), (2.0, 0.85, 0.95), (3.0, 0.65, 0.88), (4.16, 0.5, 0.8),
    (5.43, 0.35, 0.72), (6.79, 0.25, 0.64), (8.21, 0.18, 0.56), (9.70, 0.12, 0.5),
    (0.5, 0.4, 0.9), (1.5, 0.55, 0.92), (2.5, 0.4, 0.85), (3.58, 0.3, 0.78),
    (4.80, 0.22, 0.7), (6.11, 0.15, 0.62), (7.50, 0.1, 0.54), (8.96, 0.07, 0.48),
    (11.24, 0.08, 0.44), (12.85, 0.06, 0.4), (14.50, 0.04, 0.36), (16.20, 0.03, 0.32),
    (1.25, 0.5, 0.9), (2.25, 0.4, 0.83), (3.30, 0.3, 0.76), (4.50, 0.22, 0.68),
    (5.85, 0.15, 0.6), (7.30, 0.1, 0.53), (8.85, 0.07, 0.47), (10.50, 0.05, 0.42),
    (12.0, 0.04, 0.38), (13.8, 0.03, 0.34), (15.8, 0.02, 0.3), (18.0, 0.01, 0.26),
];

// Preset 4: Wine Glass — very high Q, few dominant modes, crystal-like
const WINE_GLASS: &[ModeData] = &[
    (1.0, 1.0, 1.0), (2.71, 0.75, 0.98), (5.18, 0.5, 0.94), (8.42, 0.3, 0.88),
    (12.43, 0.18, 0.8), (17.21, 0.1, 0.7), (22.76, 0.06, 0.6), (29.08, 0.03, 0.5),
    (1.35, 0.6, 0.96), (3.62, 0.45, 0.92), (6.52, 0.3, 0.86), (10.15, 0.18, 0.78),
    (14.51, 0.1, 0.68), (19.60, 0.06, 0.58), (25.42, 0.03, 0.48), (31.97, 0.02, 0.4),
    (1.82, 0.5, 0.95), (4.35, 0.35, 0.9), (7.68, 0.22, 0.83), (11.80, 0.13, 0.74),
    (16.71, 0.07, 0.64), (22.41, 0.04, 0.54), (28.90, 0.02, 0.44), (36.18, 0.01, 0.36),
    (2.25, 0.4, 0.93), (5.80, 0.25, 0.87), (9.90, 0.15, 0.79), (14.80, 0.08, 0.69),
    (20.50, 0.05, 0.59), (27.0, 0.03, 0.49), (34.3, 0.01, 0.4), (42.0, 0.005, 0.32),
];

const PRESETS: [BodyPreset; 5] = [
    BodyPreset { modes: METAL_BAR },
    BodyPreset { modes: METAL_TUBE },
    BodyPreset { modes: GLASS },
    BodyPreset { modes: BELL },
    BodyPreset { modes: WINE_GLASS },
];

/// Single biquad bandpass resonator state.
struct BiquadMode {
    b0: f32,
    a1: f32,
    a2: f32,
    y1: f32,
    y2: f32,
    gain: f32,
    active: bool,
}

impl BiquadMode {
    fn new() -> Self {
        Self { b0: 0.0, a1: 0.0, a2: 0.0, y1: 0.0, y2: 0.0, gain: 0.0, active: false }
    }

    /// Configure as bandpass at freq with given Q.
    fn set_bandpass(&mut self, freq: f32, q: f32, gain: f32, sample_rate: f32) {
        let freq = freq.clamp(20.0, sample_rate * 0.45);
        let w0 = core::f32::consts::TAU * freq / sample_rate;
        let sin_w0 = w0.sin();
        let cos_w0 = w0.cos();
        let alpha = sin_w0 / (2.0 * q);

        let a0_inv = 1.0 / (1.0 + alpha);
        self.b0 = alpha * a0_inv;
        self.a1 = -2.0 * cos_w0 * a0_inv;
        self.a2 = (1.0 - alpha) * a0_inv;
        self.gain = gain;
        self.active = true;
    }

    #[inline(always)]
    fn tick(&mut self, input: f32) -> f32 {
        let out = self.b0 * input - self.a1 * self.y1 - self.a2 * self.y2;
        self.y2 = self.y1;
        self.y1 = out;
        out * self.gain
    }

    fn reset(&mut self) {
        self.y1 = 0.0;
        self.y2 = 0.0;
    }
}

pub struct ModalResonator {
    modes: [BiquadMode; MAX_MODES],
    active_count: usize,
    sample_rate: f32,
}

impl ModalResonator {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            modes: core::array::from_fn(|_| BiquadMode::new()),
            active_count: 0,
            sample_rate,
        }
    }

    /// Configure the resonator from preset and parameters.
    pub fn set_params(
        &mut self,
        body_preset: u8,
        material: f32,    // 0=rubber (short decay), 1=metal (long decay)
        num_modes: u8,     // 4-32
        inharmonicity: f32, // 0=harmonic, 1=bell-like
    ) {
        let preset_idx = (body_preset as usize).min(PRESETS.len() - 1);
        let preset = &PRESETS[preset_idx];
        let n = (num_modes as usize).clamp(4, MAX_MODES).min(preset.modes.len());
        self.active_count = n;

        // Material controls Q: rubber=5 (damped), metal=200 (ringing)
        let base_q = 5.0 + material * 195.0;
        // Base fundamental for mode calculation (440 Hz reference)
        let fundamental = 440.0;

        for i in 0..MAX_MODES {
            if i < n {
                let (ratio, amp, decay_mult) = preset.modes[i];
                // Apply inharmonicity: stretch ratios away from harmonic
                let stretched_ratio = ratio * (1.0 + inharmonicity * ratio * 0.002);
                let freq = fundamental * stretched_ratio;
                let q = base_q * decay_mult;
                self.modes[i].set_bandpass(freq, q, amp, self.sample_rate);
            } else {
                self.modes[i].active = false;
            }
        }
    }

    /// Process one sample through all active modes.
    #[inline(always)]
    pub fn tick(&mut self, input: f32) -> f32 {
        let mut sum = 0.0f32;
        for i in 0..self.active_count {
            sum += self.modes[i].tick(input);
        }
        // Normalize by sqrt of mode count to prevent volume explosion
        let scale = 1.0 / (self.active_count as f32).sqrt().max(1.0);
        sum * scale
    }

    pub fn reset(&mut self) {
        for mode in &mut self.modes {
            mode.reset();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    #[test]
    fn output_bounded() {
        let mut mr = ModalResonator::new(SR);
        mr.set_params(0, 0.5, 16, 0.0);
        // Feed impulse then silence
        let first = mr.tick(1.0);
        let mut max_out = first.abs();
        for _ in 0..100_000 {
            let out = mr.tick(0.0);
            max_out = max_out.max(out.abs());
            assert!(!out.is_nan(), "NaN from modal resonator");
            assert!(!out.is_infinite(), "Inf from modal resonator");
        }
        assert!(max_out < 10.0, "Output should be bounded, got {max_out}");
    }

    #[test]
    fn no_nan_all_presets() {
        for preset in 0..5u8 {
            let mut mr = ModalResonator::new(SR);
            mr.set_params(preset, 1.0, 32, 1.0); // max everything
            for _ in 0..10000 {
                let out = mr.tick(0.5);
                assert!(!out.is_nan(), "NaN from preset {preset}");
            }
        }
    }

    #[test]
    fn different_presets_different_output() {
        let mut outputs: Vec<Vec<f32>> = Vec::new();
        for preset in 0..5u8 {
            let mut mr = ModalResonator::new(SR);
            mr.set_params(preset, 0.5, 16, 0.0);
            mr.tick(1.0); // impulse
            let mut samples = Vec::new();
            for _ in 0..1000 {
                samples.push(mr.tick(0.0));
            }
            outputs.push(samples);
        }
        // Each pair of presets should differ
        for i in 0..4 {
            let differ = outputs[i].iter().zip(&outputs[i + 1])
                .any(|(a, b)| (a - b).abs() > 0.001);
            assert!(differ, "Preset {i} and {} should differ", i + 1);
        }
    }

    #[test]
    fn material_affects_decay() {
        // Metal (material=1, high Q) should still have audible output after 1 second.
        // Rubber (material=0, low Q) should have decayed to near silence by then.
        let mut mr_rubber = ModalResonator::new(SR);
        mr_rubber.set_params(0, 0.0, 8, 0.0);
        mr_rubber.tick(1.0);
        for _ in 0..44100 { mr_rubber.tick(0.0); }
        let rubber_tail: f32 = (0..4410).map(|_| mr_rubber.tick(0.0).abs()).sum();

        let mut mr_metal = ModalResonator::new(SR);
        mr_metal.set_params(0, 1.0, 8, 0.0);
        mr_metal.tick(1.0);
        for _ in 0..44100 { mr_metal.tick(0.0); }
        let metal_tail: f32 = (0..4410).map(|_| mr_metal.tick(0.0).abs()).sum();

        assert!(metal_tail > rubber_tail,
            "Metal should still ring after 1s while rubber decays: metal_tail={metal_tail}, rubber_tail={rubber_tail}");
    }

    #[test]
    fn modes_count_affects_output() {
        let mut mr4 = ModalResonator::new(SR);
        mr4.set_params(0, 0.5, 4, 0.0);
        mr4.tick(1.0);

        let mut mr32 = ModalResonator::new(SR);
        mr32.set_params(0, 0.5, 32, 0.0);
        mr32.tick(1.0);

        // More modes should produce richer (different) output
        let mut differ = false;
        for _ in 0..1000 {
            let a = mr4.tick(0.0);
            let b = mr32.tick(0.0);
            if (a - b).abs() > 0.001 {
                differ = true;
                break;
            }
        }
        assert!(differ, "4 modes and 32 modes should produce different output");
    }

    #[test]
    fn reset_clears_state() {
        let mut mr = ModalResonator::new(SR);
        mr.set_params(0, 0.5, 16, 0.0);
        mr.tick(1.0);
        for _ in 0..100 { mr.tick(0.0); }
        mr.reset();
        // After reset with zero input, output should be zero
        let out = mr.tick(0.0);
        assert_eq!(out, 0.0, "Reset should clear state");
    }

    #[test]
    fn mix_zero_bypass() {
        // This tests the engine integration logic, not the resonator itself.
        // But verify the resonator produces nonzero output (so mix=0 bypass is meaningful).
        let mut mr = ModalResonator::new(SR);
        mr.set_params(2, 0.5, 16, 0.0); // Glass
        mr.tick(1.0);
        let mut has_nonzero = false;
        for _ in 0..1000 {
            if mr.tick(0.0).abs() > 0.001 {
                has_nonzero = true;
                break;
            }
        }
        assert!(has_nonzero, "Resonator should produce output after impulse");
    }
}

/// IR3109 OTA 4-pole ladder filter — TPT implementation.
/// Per the JP-8 spec §2.3.

use crate::math::{fast_tan, fast_tanh};

pub struct IR3109 {
    s: [f32; 4],
    pub cutoff_hz: f32,
    pub resonance: f32,
    g: f32,
    sample_rate: f32,
}

impl IR3109 {
    pub fn new(sample_rate: f32) -> Self {
        let mut f = Self {
            s: [0.0; 4],
            cutoff_hz: 8000.0,
            resonance: 0.0,
            g: 0.0,
            sample_rate,
        };
        f.set_cutoff(8000.0);
        f
    }

    #[inline(always)]
    pub fn set_cutoff(&mut self, hz: f32) {
        let freq = hz.clamp(20.0, self.sample_rate * 0.45);
        self.g = fast_tan(core::f32::consts::PI * freq / (self.sample_rate * 2.0));
        self.cutoff_hz = freq;
    }

    #[inline(always)]
    pub fn tick(&mut self, input: f32) -> f32 {
        let y1 = self.tick_inner(input);
        let y2 = self.tick_inner(input);
        (y1 + y2) * 0.5
    }

    #[inline(always)]
    fn tick_inner(&mut self, input: f32) -> f32 {
        let k = self.resonance * 4.0;
        let feedback = self.s[3];
        let x = input - k * feedback;
        let y0 = self.one_pole(0, x);
        let y1 = self.one_pole(1, y0);
        let y2 = self.one_pole(2, y1);
        self.one_pole(3, y2)
    }

    #[inline(always)]
    fn one_pole(&mut self, stage: usize, input: f32) -> f32 {
        let v = (fast_tanh(input) - self.s[stage]) * self.g;
        let y = v + self.s[stage];
        self.s[stage] = y + v;
        y
    }

    pub fn reset(&mut self) { self.s = [0.0; 4]; }
}

/// Simple 1-pole highpass filter.
/// Sits after the main VCF in the JP-8 signal chain.
pub struct HighPass {
    prev_input: f32,
    prev_output: f32,
    coeff: f32,
    sample_rate: f32,
}

impl HighPass {
    pub fn new(sample_rate: f32) -> Self {
        let mut hp = Self {
            prev_input: 0.0,
            prev_output: 0.0,
            coeff: 0.0,
            sample_rate,
        };
        hp.set_cutoff(20.0);
        hp
    }

    pub fn set_cutoff(&mut self, hz: f32) {
        let freq = hz.clamp(20.0, self.sample_rate * 0.45);
        let rc = 1.0 / (core::f32::consts::TAU * freq);
        let dt = 1.0 / self.sample_rate;
        self.coeff = rc / (rc + dt);
    }

    #[inline(always)]
    pub fn tick(&mut self, input: f32) -> f32 {
        let y = self.coeff * (self.prev_output + input - self.prev_input);
        self.prev_input = input;
        self.prev_output = y;
        y
    }

    pub fn reset(&mut self) {
        self.prev_input = 0.0;
        self.prev_output = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    #[test]
    fn lpf_passes_dc() {
        let mut f = IR3109::new(SR);
        f.set_cutoff(8000.0);
        f.resonance = 0.0;
        let mut out = 0.0;
        // The IR3109 uses tanh saturation, so DC gain isn't exactly 1.0
        // With input=1.0 through tanh, steady state converges to ~0.53
        // Use a smaller input to stay in the linear region
        for _ in 0..50000 {
            out = f.tick(0.1);
        }
        assert!((out - 0.1).abs() < 0.05, "DC should pass through LPF (linear region), got {out}");
    }

    #[test]
    fn lpf_attenuates_nyquist() {
        let mut f = IR3109::new(SR);
        f.set_cutoff(200.0);
        f.resonance = 0.0;
        // Let filter settle
        for _ in 0..1000 {
            f.tick(0.0);
        }
        // Feed alternating ±1 (Nyquist-like signal)
        let mut max_out = 0.0f32;
        for i in 0..1000 {
            let input = if i % 2 == 0 { 1.0 } else { -1.0 };
            let out = f.tick(input);
            max_out = max_out.max(out.abs());
        }
        assert!(max_out < 0.01, "Nyquist signal should be attenuated, got {max_out}");
    }

    #[test]
    fn resonance_zero_no_ring() {
        let mut f = IR3109::new(SR);
        f.set_cutoff(1000.0);
        f.resonance = 0.0;
        // Impulse with small signal (linear region of tanh)
        let first = f.tick(0.1);
        // Allow initial transient (2x oversampled filter may have brief settling)
        // Check that after initial 5 samples, response decays
        let mut samples: Vec<f32> = vec![first.abs()];
        for _ in 1..200 {
            samples.push(f.tick(0.0).abs());
        }
        // Find peak, then check decay from there
        let peak_idx = samples.iter().enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .unwrap().0;
        let mut prev = samples[peak_idx];
        let mut monotonic = true;
        for &s in &samples[peak_idx + 1..] {
            if s > prev + 1e-6 {
                monotonic = false;
                break;
            }
            prev = s;
        }
        assert!(monotonic, "Impulse response should decay monotonically after peak at reso=0");
    }

    #[test]
    fn resonance_high_peaks() {
        let mut f = IR3109::new(SR);
        f.set_cutoff(1000.0);
        f.resonance = 0.95;
        // Impulse
        let first = f.tick(1.0).abs();
        let mut max_out = first;
        for _ in 1..2000 {
            let out = f.tick(0.0).abs();
            max_out = max_out.max(out);
        }
        assert!(max_out > first, "High resonance impulse should ring above initial level");
    }

    #[test]
    fn cutoff_clamp_low() {
        let mut f = IR3109::new(SR);
        f.set_cutoff(5.0);
        assert_eq!(f.cutoff_hz, 20.0);
    }

    #[test]
    fn cutoff_clamp_high() {
        let mut f = IR3109::new(SR);
        f.set_cutoff(30000.0);
        assert_eq!(f.cutoff_hz, SR * 0.45);
    }

    #[test]
    fn no_nan_extreme_input() {
        let mut f = IR3109::new(SR);
        f.set_cutoff(1000.0);
        f.resonance = 0.9;
        for &input in &[1e6, -1e6, 0.0, 1e6, -1e6] {
            let out = f.tick(input);
            assert!(!out.is_nan(), "NaN from extreme input {input}");
            assert!(!out.is_infinite(), "Inf from extreme input {input}");
        }
    }

    #[test]
    fn reset_clears_state() {
        let mut f = IR3109::new(SR);
        for _ in 0..100 {
            f.tick(1.0);
        }
        f.reset();
        assert_eq!(f.tick(0.0), 0.0, "Filter should output 0 after reset with 0 input");
    }

    #[test]
    fn hpf_blocks_dc() {
        let mut hp = HighPass::new(SR);
        hp.set_cutoff(20.0);
        let mut out = 0.0;
        for _ in 0..100_000 {
            out = hp.tick(1.0);
        }
        assert!(out.abs() < 0.01, "HPF should block DC, got {out}");
    }

    #[test]
    fn hpf_passes_high_freq() {
        let mut hp = HighPass::new(SR);
        hp.set_cutoff(20.0);
        // Let settle
        for _ in 0..1000 {
            hp.tick(0.0);
        }
        // Feed high-freq signal
        let mut max_out = 0.0f32;
        for i in 0..1000 {
            let input = if i % 2 == 0 { 1.0 } else { -1.0 };
            let out = hp.tick(input);
            max_out = max_out.max(out.abs());
        }
        assert!(max_out > 0.9, "HPF should pass high freq, got {max_out}");
    }
}

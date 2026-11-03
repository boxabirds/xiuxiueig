/// Benjolin chaos modulator.
/// Two cross-modulating triangle oscillators drive an 8-bit shift register
/// (rungler) with XOR feedback and a 3-bit DAC. The DAC output modulates
/// both oscillator frequencies, creating deterministic chaos.
///
/// Cost: ~20 operations per sample.

const RUNGLER_BITS: u8 = 8;
const DAC_SCALE: f32 = 1.0 / 7.0; // 3-bit DAC: values 0-7

pub struct Benjolin {
    osc1_phase: f32,
    osc2_phase: f32,
    osc1_rate: f32,     // Hz
    osc2_rate: f32,     // Hz
    depth: f32,         // 0-1: how much rungler modulates frequencies
    shift_register: u8, // 8-bit state
    prev_osc1_phase: f32,
    dac_value: f32,     // normalized 0-1, raw stepped
    smoothed: f32,      // one-pole lowpass of dac_value
    slew_coeff: f32,    // smoothing coefficient (higher = faster tracking)
    output: f32,        // [-1, 1]
}

impl Benjolin {
    pub fn new() -> Self {
        Self {
            osc1_phase: 0.0,
            osc2_phase: 0.0,
            osc1_rate: 5.0,
            osc2_rate: 7.0,
            depth: 0.0,
            shift_register: 0b10110101, // nonzero seed
            prev_osc1_phase: 0.0,
            dac_value: 0.0,
            smoothed: 0.0,
            slew_coeff: 0.005, // ~3ms slew at 44.1kHz — smooth but responsive
            output: 0.0,
        }
    }

    pub fn set_params(&mut self, rate1: f32, rate2: f32, depth: f32) {
        self.osc1_rate = rate1;
        self.osc2_rate = rate2;
        self.depth = depth;
    }

    /// Generate one chaos sample in [-1, 1].
    #[inline(always)]
    pub fn tick(&mut self, inv_sr: f32) -> f32 {
        // Rungler modulates both osc frequencies
        let mod_amount = self.dac_value * self.depth;
        let rate1 = self.osc1_rate * (1.0 + mod_amount * 2.0);
        let rate2 = self.osc2_rate * (1.0 + mod_amount * 2.0);

        // Advance oscillators
        self.prev_osc1_phase = self.osc1_phase;
        self.osc1_phase += rate1 * inv_sr;
        self.osc2_phase += rate2 * inv_sr;

        // Phase wrap
        let osc1_wrapped = self.osc1_phase >= 1.0;
        if osc1_wrapped { self.osc1_phase -= 1.0; }
        if self.osc2_phase >= 1.0 { self.osc2_phase -= 1.0; }

        // On osc1 rising edge (phase wrap): clock the shift register
        if osc1_wrapped {
            // Input bit: osc2 polarity (positive half = 1)
            let input_bit = if self.osc2_phase < 0.5 { 1u8 } else { 0u8 };

            // XOR feedback from bit 5
            let feedback = (self.shift_register >> 5) & 1;
            let new_bit = input_bit ^ feedback;

            // Shift left, insert new bit at LSB
            self.shift_register = (self.shift_register << 1) | new_bit;

            // 3-bit DAC reads bits [0, 3, 6]
            let bit0 = self.shift_register & 1;
            let bit3 = (self.shift_register >> 3) & 1;
            let bit6 = (self.shift_register >> 6) & 1;
            let dac_raw = bit0 | (bit3 << 1) | (bit6 << 2); // 0-7
            self.dac_value = dac_raw as f32 * DAC_SCALE;
        }

        // Slew-limit the DAC value (one-pole lowpass)
        let target = self.dac_value * 2.0 - 1.0; // map [0,1] to [-1,1]
        self.smoothed += self.slew_coeff * (target - self.smoothed);
        self.output = self.smoothed;
        self.output
    }

    pub fn reset(&mut self) {
        self.osc1_phase = 0.0;
        self.osc2_phase = 0.0;
        self.prev_osc1_phase = 0.0;
        self.shift_register = 0b10110101;
        self.dac_value = 0.0;
        self.smoothed = 0.0;
        self.output = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INV_SR: f32 = 1.0 / 44100.0;

    #[test]
    fn output_bounded() {
        let mut b = Benjolin::new();
        b.set_params(5.0, 7.0, 1.0);
        for _ in 0..100_000 {
            let out = b.tick(INV_SR);
            assert!(out >= -1.0 && out <= 1.0, "output out of bounds: {out}");
        }
    }

    #[test]
    fn no_nan() {
        let mut b = Benjolin::new();
        // Extreme params
        b.set_params(30.0, 0.1, 1.0);
        for _ in 0..100_000 {
            let out = b.tick(INV_SR);
            assert!(!out.is_nan(), "NaN from benjolin");
            assert!(!out.is_infinite(), "Inf from benjolin");
        }
    }

    #[test]
    fn depth_zero_constant() {
        let mut b = Benjolin::new();
        b.set_params(5.0, 7.0, 0.0);
        // With depth=0, rungler doesn't modulate frequencies,
        // but DAC still updates on osc1 wrap. Output should still be bounded.
        let mut has_nonzero = false;
        for _ in 0..44100 {
            let out = b.tick(INV_SR);
            if out.abs() > 0.01 { has_nonzero = true; }
        }
        // DAC produces values, so output won't be zero even at depth=0
        assert!(has_nonzero, "Benjolin should produce output even at depth=0");
    }

    #[test]
    fn different_rates_different_patterns() {
        let mut b1 = Benjolin::new();
        b1.set_params(5.0, 7.0, 0.5);
        let mut b2 = Benjolin::new();
        b2.set_params(3.0, 11.0, 0.5);

        let mut differ = false;
        for _ in 0..10000 {
            let o1 = b1.tick(INV_SR);
            let o2 = b2.tick(INV_SR);
            if (o1 - o2).abs() > 0.01 {
                differ = true;
                break;
            }
        }
        assert!(differ, "Different rates should produce different patterns");
    }

    #[test]
    fn reset_clears_state() {
        let mut b = Benjolin::new();
        b.set_params(5.0, 7.0, 0.5);
        for _ in 0..10000 {
            b.tick(INV_SR);
        }
        b.reset();
        assert_eq!(b.osc1_phase, 0.0);
        assert_eq!(b.osc2_phase, 0.0);
        assert_eq!(b.output, 0.0);
    }
}

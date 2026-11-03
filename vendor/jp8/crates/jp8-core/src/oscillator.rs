/// PolyBLEP anti-aliased oscillator with waveform mixing.
/// JP-8 allows saw AND pulse simultaneously per VCO (additive, not selector).
/// wave_flags: bit 0 = saw, bit 1 = pulse.

pub struct Oscillator {
    pub phase: f32,
    pub freq: f32,
    pub target_freq: f32,       // for portamento
    pub pulse_width: f32,
    porta_coeff: f32,           // 0 = instant, close to 1 = slow glide
    drift: f32,
    drift_phase: f32,
    drift_state: f32,
    sub_toggle: bool,           // flips on each phase wrap for sub-osc half-rate
}

impl Oscillator {
    pub fn new() -> Self {
        Self {
            phase: 0.0,
            freq: 440.0,
            target_freq: 440.0,
            pulse_width: 0.5,
            porta_coeff: 0.0,
            drift: 0.0,
            drift_phase: 0.0,
            drift_state: 0.0,
            sub_toggle: false,
        }
    }

    pub fn set_freq(&mut self, hz: f32, drift_amount: f32) {
        self.target_freq = hz;
        self.drift = drift_amount;
    }

    /// Set freq immediately (no glide).
    pub fn set_freq_immediate(&mut self, hz: f32, drift_amount: f32) {
        self.freq = hz;
        self.target_freq = hz;
        self.drift = drift_amount;
    }

    pub fn set_portamento(&mut self, time_secs: f32, sample_rate: f32) {
        if time_secs < 0.001 {
            self.porta_coeff = 0.0;
        } else {
            self.porta_coeff = (-2.0 / (time_secs * sample_rate)).exp();
        }
    }

    /// Generate one sample with waveform mixing. wave_flags: bit0=saw, bit1=pulse.
    /// Returns the mixed output and advances phase.
    #[inline(always)]
    pub fn tick(&mut self, inv_sr: f32, wave_flags: u8) -> f32 {
        // Portamento glide
        if self.porta_coeff > 0.0 {
            self.freq += (1.0 - self.porta_coeff) * (self.target_freq - self.freq);
        } else {
            self.freq = self.target_freq;
        }

        let drift_hz = self.update_drift(inv_sr);
        let effective_freq = self.freq + drift_hz;
        let dt = effective_freq * inv_sr;

        let mut out = 0.0;
        if wave_flags & 1 != 0 {
            out += self.saw(dt);
        }
        if wave_flags & 2 != 0 {
            out += self.pulse(dt);
        }

        self.phase += dt;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            self.sub_toggle = !self.sub_toggle;
        }
        if self.phase < 0.0 {
            self.phase += 1.0;
            self.sub_toggle = !self.sub_toggle;
        }

        out
    }

    /// Tick with frequency modulation (for cross-mod target).
    #[inline(always)]
    pub fn tick_with_fm(&mut self, inv_sr: f32, wave_flags: u8, fm_amount: f32) -> f32 {
        if self.porta_coeff > 0.0 {
            self.freq += (1.0 - self.porta_coeff) * (self.target_freq - self.freq);
        } else {
            self.freq = self.target_freq;
        }

        let drift_hz = self.update_drift(inv_sr);
        let effective_freq = self.freq + drift_hz;
        let dt = (effective_freq * inv_sr + fm_amount).max(0.0);

        let mut out = 0.0;
        if wave_flags & 1 != 0 { out += self.saw(dt); }
        if wave_flags & 2 != 0 { out += self.pulse(dt); }

        self.phase += dt;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            self.sub_toggle = !self.sub_toggle;
        }
        if self.phase < 0.0 {
            self.phase += 1.0;
            self.sub_toggle = !self.sub_toggle;
        }

        out
    }

    /// Sub-oscillator: square wave one octave below.
    /// Toggles polarity on each VCO phase wrap → half the VCO frequency.
    #[inline(always)]
    pub fn sub_oscillator(&self) -> f32 {
        if self.sub_toggle { 1.0 } else { -1.0 }
    }

    #[inline(always)]
    fn saw(&self, dt: f32) -> f32 {
        let naive = 2.0 * self.phase - 1.0;
        naive - poly_blep(self.phase, dt)
    }

    #[inline(always)]
    fn pulse(&self, dt: f32) -> f32 {
        let mut out = if self.phase < self.pulse_width { 1.0 } else { -1.0 };
        out += poly_blep(self.phase, dt);
        out -= poly_blep((self.phase - self.pulse_width + 1.0) % 1.0, dt);
        out
    }

    #[inline(always)]
    fn update_drift(&mut self, inv_sr: f32) -> f32 {
        if self.drift <= 0.0 { return 0.0; }
        self.drift_phase += 0.3 * inv_sr;
        if self.drift_phase >= 1.0 {
            self.drift_phase -= 1.0;
            let bits = (self.phase * 1000.0) as u32;
            let rand = ((bits.wrapping_mul(1103515245).wrapping_add(12345)) >> 16) as f32 / 32768.0 - 1.0;
            self.drift_state = rand;
        }
        let cents = self.drift_state * self.drift * 3.0;
        self.freq * (2.0f32.powf(cents / 1200.0) - 1.0)
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
        self.sub_toggle = false;
    }
}

#[inline(always)]
fn poly_blep(t: f32, dt: f32) -> f32 {
    if dt <= 0.0 { return 0.0; }
    if t < dt {
        let t = t / dt;
        t + t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + t + t + 1.0
    } else {
        0.0
    }
}

/// White noise generator.
pub struct NoiseGen {
    state: u32,
}

impl NoiseGen {
    pub fn new(seed: u32) -> Self {
        Self { state: if seed == 0 { 1 } else { seed } }
    }

    #[inline(always)]
    pub fn next(&mut self) -> f32 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 17;
        self.state ^= self.state << 5;
        (self.state as f32 / u32::MAX as f32) * 2.0 - 1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;
    const INV_SR: f32 = 1.0 / 44100.0;

    fn make_osc(freq: f32) -> Oscillator {
        let mut osc = Oscillator::new();
        osc.set_freq_immediate(freq, 0.0);
        osc
    }

    #[test]
    fn saw_output_bounded() {
        let mut osc = make_osc(440.0);
        for _ in 0..1000 {
            let s = osc.tick(INV_SR, 1); // saw
            assert!(s >= -1.1 && s <= 1.1, "saw sample out of bounds: {s}");
        }
    }

    #[test]
    fn pulse_output_bounded() {
        let mut osc = make_osc(440.0);
        for _ in 0..1000 {
            let s = osc.tick(INV_SR, 2); // pulse
            assert!(s >= -1.2 && s <= 1.2, "pulse sample out of bounds: {s}");
        }
    }

    #[test]
    fn saw_and_pulse_additive() {
        let mut osc_both = make_osc(440.0);

        // Verify both waveforms produce non-zero output and combined is non-zero
        let mut has_output = false;
        for _ in 0..4410 {
            let b = osc_both.tick(INV_SR, 3); // saw + pulse
            if b.abs() > 0.01 {
                has_output = true;
            }
        }
        assert!(has_output, "Combined saw+pulse should produce output");

        // Verify flags=3 produces different output than flags=1
        let mut osc_saw = make_osc(440.0);
        let mut osc_both2 = make_osc(440.0);
        let mut differ = false;
        for _ in 0..100 {
            let s = osc_saw.tick(INV_SR, 1);
            let b = osc_both2.tick(INV_SR, 3);
            if (s - b).abs() > 0.01 {
                differ = true;
                break;
            }
        }
        assert!(differ, "saw+pulse should differ from saw alone");
    }

    #[test]
    fn wave_flags_zero_silence() {
        let mut osc = make_osc(440.0);
        for _ in 0..100 {
            let s = osc.tick(INV_SR, 0);
            assert_eq!(s, 0.0);
        }
    }

    #[test]
    fn phase_stays_in_range() {
        let mut osc = make_osc(440.0);
        for _ in 0..100_000 {
            osc.tick(INV_SR, 1);
            assert!(osc.phase >= 0.0 && osc.phase < 1.0, "phase out of range: {}", osc.phase);
        }
    }

    #[test]
    fn portamento_converges() {
        let mut osc = make_osc(220.0);
        osc.set_portamento(0.1, SR);
        osc.set_freq(880.0, 0.0);
        // Tick for 0.5 seconds (well beyond 0.1s porta time)
        for _ in 0..22050 {
            osc.tick(INV_SR, 1);
        }
        assert!((osc.freq - 880.0).abs() < 1.0, "freq didn't converge: {}", osc.freq);
    }

    #[test]
    fn portamento_instant_below_threshold() {
        let mut osc = make_osc(220.0);
        osc.set_portamento(0.0005, SR); // below 0.001 threshold
        osc.set_freq(880.0, 0.0);
        osc.tick(INV_SR, 1);
        assert_eq!(osc.freq, 880.0, "freq should be instant with porta < 0.001s");
    }

    #[test]
    fn sub_oscillator_square() {
        let mut osc = make_osc(440.0);
        for _ in 0..1000 {
            osc.tick(INV_SR, 1);
            let sub = osc.sub_oscillator();
            assert!(sub == 1.0 || sub == -1.0, "sub-osc output not ±1: {sub}");
        }
    }

    #[test]
    fn sub_oscillator_half_rate() {
        let mut osc = make_osc(440.0);
        // Sub-osc should toggle between +1 and -1 at half the VCO rate.
        // At 440Hz VCO, sub is 220Hz → ~440 transitions per second.
        let mut transitions = 0;
        let mut prev = osc.sub_oscillator();
        for _ in 0..44100 {
            osc.tick(INV_SR, 1);
            let sub = osc.sub_oscillator();
            assert!(sub == 1.0 || sub == -1.0, "Sub should be ±1, got {sub}");
            if sub != prev {
                transitions += 1;
            }
            prev = sub;
        }
        // 220Hz = 220 full cycles = 440 transitions per second
        assert!(transitions > 300 && transitions < 600,
            "sub transitions={transitions}, expected ~440");
    }

    #[test]
    fn fm_zero_amount_unchanged() {
        let mut osc1 = make_osc(440.0);
        let mut osc2 = make_osc(440.0);
        for _ in 0..100 {
            let a = osc1.tick(INV_SR, 1);
            let b = osc2.tick_with_fm(INV_SR, 1, 0.0);
            assert!((a - b).abs() < 1e-6, "FM with 0 amount should match normal tick");
        }
    }

    #[test]
    fn fm_negative_dt_clamped() {
        let mut osc = make_osc(440.0);
        for _ in 0..1000 {
            let s = osc.tick_with_fm(INV_SR, 1, -10.0); // large negative FM
            assert!(!s.is_nan(), "FM produced NaN");
            assert!(!s.is_infinite(), "FM produced Inf");
        }
    }

    #[test]
    fn noise_bounded() {
        let mut noise = NoiseGen::new(0); // seed=0 should become 1
        for _ in 0..10000 {
            let s = noise.next();
            assert!(!s.is_nan(), "noise NaN");
            assert!(s >= -1.0 && s <= 1.0, "noise out of bounds: {s}");
        }
    }
}

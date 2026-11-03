/// Stereo BBD chorus emulation.
/// Per the JP-8 spec §2.6.

const CHORUS_BUFFER_SIZE: usize = 2048;

#[derive(Clone, Copy, PartialEq)]
pub enum ChorusMode {
    Off,
    Mode1,   // ~0.513 Hz, ~1.5ms depth
    Mode2,   // ~0.863 Hz, ~2.3ms depth
    Mode12,  // Both — the classic JP-8 sound
}

pub struct StereoChorus {
    buffer_l: [f32; CHORUS_BUFFER_SIZE],
    buffer_r: [f32; CHORUS_BUFFER_SIZE],
    write_pos: usize,
    lfo_phase_1: f32,
    lfo_phase_2: f32,
    pub mode: ChorusMode,
    pub mix: f32,
    sample_rate: f32,
}

impl StereoChorus {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            buffer_l: [0.0; CHORUS_BUFFER_SIZE],
            buffer_r: [0.0; CHORUS_BUFFER_SIZE],
            write_pos: 0,
            lfo_phase_1: 0.0,
            lfo_phase_2: 0.25, // offset for stereo
            mode: ChorusMode::Mode12,
            mix: 0.5,
            sample_rate,
        }
    }

    /// Process one stereo sample pair. Returns (left, right).
    #[inline(always)]
    pub fn tick(&mut self, input: f32) -> (f32, f32) {
        if self.mode == ChorusMode::Off {
            return (input, input);
        }

        // Write input to both delay buffers
        self.buffer_l[self.write_pos] = input;
        self.buffer_r[self.write_pos] = input;

        let inv_sr = 1.0 / self.sample_rate;
        let (delay_l, delay_r) = match self.mode {
            ChorusMode::Off => unreachable!(),
            ChorusMode::Mode1 => {
                let (dl, dr) = self.chorus_1(inv_sr);
                (dl, dr)
            }
            ChorusMode::Mode2 => {
                let (dl, dr) = self.chorus_2(inv_sr);
                (dl, dr)
            }
            ChorusMode::Mode12 => {
                let (dl1, dr1) = self.chorus_1(inv_sr);
                let (dl2, dr2) = self.chorus_2(inv_sr);
                ((dl1 + dl2) * 0.5, (dr1 + dr2) * 0.5)
            }
        };

        self.write_pos = (self.write_pos + 1) % CHORUS_BUFFER_SIZE;

        let wet_l = delay_l;
        let wet_r = delay_r;
        let dry = input;

        (
            dry * (1.0 - self.mix) + wet_l * self.mix,
            dry * (1.0 - self.mix) + wet_r * self.mix,
        )
    }

    fn chorus_1(&mut self, inv_sr: f32) -> (f32, f32) {
        const RATE: f32 = 0.513;
        const DEPTH_MS: f32 = 1.5;

        self.lfo_phase_1 += RATE * inv_sr;
        if self.lfo_phase_1 >= 1.0 {
            self.lfo_phase_1 -= 1.0;
        }

        let lfo_l = (self.lfo_phase_1 * core::f32::consts::TAU).sin();
        let lfo_r = ((self.lfo_phase_1 + 0.5) * core::f32::consts::TAU).sin();

        let base_delay = DEPTH_MS * 0.001 * self.sample_rate;
        let delay_l = base_delay + lfo_l * base_delay * 0.5;
        let delay_r = base_delay + lfo_r * base_delay * 0.5;

        (
            self.read_interpolated(&self.buffer_l, delay_l),
            self.read_interpolated(&self.buffer_r, delay_r),
        )
    }

    fn chorus_2(&mut self, inv_sr: f32) -> (f32, f32) {
        const RATE: f32 = 0.863;
        const DEPTH_MS: f32 = 2.3;

        self.lfo_phase_2 += RATE * inv_sr;
        if self.lfo_phase_2 >= 1.0 {
            self.lfo_phase_2 -= 1.0;
        }

        let lfo_l = (self.lfo_phase_2 * core::f32::consts::TAU).sin();
        let lfo_r = ((self.lfo_phase_2 + 0.5) * core::f32::consts::TAU).sin();

        let base_delay = DEPTH_MS * 0.001 * self.sample_rate;
        let delay_l = base_delay + lfo_l * base_delay * 0.5;
        let delay_r = base_delay + lfo_r * base_delay * 0.5;

        (
            self.read_interpolated(&self.buffer_l, delay_l),
            self.read_interpolated(&self.buffer_r, delay_r),
        )
    }

    #[inline(always)]
    fn read_interpolated(&self, buffer: &[f32; CHORUS_BUFFER_SIZE], delay: f32) -> f32 {
        let pos = self.write_pos as f32 - delay;
        let pos = if pos < 0.0 {
            pos + CHORUS_BUFFER_SIZE as f32
        } else {
            pos
        };
        let idx = pos as usize;
        let frac = pos - idx as f32;
        let a = buffer[idx % CHORUS_BUFFER_SIZE];
        let b = buffer[(idx + 1) % CHORUS_BUFFER_SIZE];
        a + frac * (b - a)
    }

    pub fn reset(&mut self) {
        self.buffer_l = [0.0; CHORUS_BUFFER_SIZE];
        self.buffer_r = [0.0; CHORUS_BUFFER_SIZE];
        self.write_pos = 0;
        self.lfo_phase_1 = 0.0;
        self.lfo_phase_2 = 0.25;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    fn make_chorus(mode: ChorusMode) -> StereoChorus {
        let mut c = StereoChorus::new(SR);
        c.mode = mode;
        c
    }

    #[test]
    fn off_passthrough() {
        let mut c = make_chorus(ChorusMode::Off);
        let (l, r) = c.tick(0.5);
        assert_eq!(l, 0.5);
        assert_eq!(r, 0.5);
    }

    #[test]
    fn mode1_stereo_spread() {
        let mut c = make_chorus(ChorusMode::Mode1);
        // Feed varying signal so delay line has content to modulate
        for i in 0..10000 {
            let input = (i as f32 * 0.1).sin();
            c.tick(input);
        }
        let mut found_diff = false;
        for i in 0..10000 {
            let input = (i as f32 * 0.1).sin();
            let (l, r) = c.tick(input);
            if (l - r).abs() > 0.001 {
                found_diff = true;
                break;
            }
        }
        assert!(found_diff, "Mode1 should produce stereo difference");
    }

    #[test]
    fn mode2_wider_than_mode1() {
        let mut c1 = make_chorus(ChorusMode::Mode1);
        let mut c2 = make_chorus(ChorusMode::Mode2);

        let mut diff1 = 0.0f32;
        let mut diff2 = 0.0f32;
        for _ in 0..10000 {
            let (l, r) = c1.tick(0.5);
            diff1 += (l - r).abs();
            let (l, r) = c2.tick(0.5);
            diff2 += (l - r).abs();
        }
        assert!(diff2 > diff1, "Mode2 should have wider stereo than Mode1");
    }

    #[test]
    fn mode12_combined() {
        let mut c1 = make_chorus(ChorusMode::Mode1);
        let mut c2 = make_chorus(ChorusMode::Mode2);
        let mut c12 = make_chorus(ChorusMode::Mode12);

        // Mode12 output should differ from both Mode1 and Mode2
        let mut out1 = Vec::new();
        let mut out2 = Vec::new();
        let mut out12 = Vec::new();
        for _ in 0..1000 {
            out1.push(c1.tick(0.5));
            out2.push(c2.tick(0.5));
            out12.push(c12.tick(0.5));
        }
        let differs_from_1 = out12.iter().zip(&out1).any(|((l12, _), (l1, _))| (l12 - l1).abs() > 0.001);
        let differs_from_2 = out12.iter().zip(&out2).any(|((l12, _), (l2, _))| (l12 - l2).abs() > 0.001);
        assert!(differs_from_1, "Mode12 should differ from Mode1");
        assert!(differs_from_2, "Mode12 should differ from Mode2");
    }

    #[test]
    fn silence_in_silence_out() {
        let mut c = make_chorus(ChorusMode::Mode12);
        for _ in 0..1000 {
            let (l, r) = c.tick(0.0);
            assert!(l.abs() < 1e-6 && r.abs() < 1e-6, "Should be silent: ({l}, {r})");
        }
    }

    #[test]
    fn no_nan_long_run() {
        let mut c = make_chorus(ChorusMode::Mode12);
        for i in 0..100_000 {
            let input = (i as f32 * 0.01).sin();
            let (l, r) = c.tick(input);
            assert!(!l.is_nan() && !r.is_nan(), "NaN at sample {i}");
            assert!(!l.is_infinite() && !r.is_infinite(), "Inf at sample {i}");
        }
    }

    #[test]
    fn reset_clears_buffers() {
        let mut c = make_chorus(ChorusMode::Mode1);
        for _ in 0..1000 {
            c.tick(1.0);
        }
        c.reset();
        // After reset, buffers are zeroed, so output from zero input should be ~0
        for _ in 0..100 {
            let (l, r) = c.tick(0.0);
            assert!(l.abs() < 1e-6 && r.abs() < 1e-6);
        }
    }

    #[test]
    fn output_bounded() {
        let mut c = make_chorus(ChorusMode::Mode12);
        let input_peak = 1.0;
        let mut max_out = 0.0f32;
        for _ in 0..100_000 {
            let (l, r) = c.tick(input_peak);
            max_out = max_out.max(l.abs()).max(r.abs());
        }
        assert!(max_out < 2.0 * input_peak, "Output should not exceed 2x input, got {max_out}");
    }
}

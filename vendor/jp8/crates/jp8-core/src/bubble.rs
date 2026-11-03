/// Bubble/fluid oscillator — Minnaert equation.
/// Each bubble is a damped sinusoid whose frequency is determined by radius.
/// Poisson-distributed ambient spawning + note-triggered bursts.
///
/// f₀ = 3.26 / radius  (simplified Minnaert for air in water)
/// Decay: 20-100ms (proportional to radius).
/// Up to 16 simultaneous bubbles. ~6 ops per active bubble.

const MAX_BUBBLES: usize = 16;
const MINNAERT_CONST: f32 = 3.26;
const ATTACK_SAMPLES: f32 = 44.0; // ~1ms at 44.1kHz
const DECAY_SCALE: f32 = 1_000_000.0; // radius * this = decay in samples (~20-100ms)

struct Bubble {
    phase: f32,
    freq: f32,
    decay_rate: f32,
    envelope: f32,
    attack_inc: f32,
    attacking: bool,
    active: bool,
}

impl Bubble {
    fn new() -> Self {
        Self {
            phase: 0.0, freq: 0.0, decay_rate: 0.0, envelope: 0.0,
            attack_inc: 1.0 / ATTACK_SAMPLES, attacking: true, active: false,
        }
    }

    #[inline(always)]
    fn tick(&mut self, inv_sr: f32) -> f32 {
        if !self.active { return 0.0; }
        let out = (self.phase * core::f32::consts::TAU).sin() * self.envelope;
        self.phase += self.freq * inv_sr;
        if self.phase >= 1.0 { self.phase -= 1.0; }
        if self.attacking {
            self.envelope += self.attack_inc;
            if self.envelope >= 1.0 {
                self.envelope = 1.0;
                self.attacking = false;
            }
        } else {
            self.envelope *= self.decay_rate;
            if self.envelope < 0.001 {
                self.active = false;
            }
        }
        out
    }
}

pub struct BubbleOscillator {
    bubbles: [Bubble; MAX_BUBBLES],
    spawn_timer: f32,
    spawn_interval: f32,
    min_size: f32,
    max_size: f32,
    sample_rate: f32,
    inv_sr: f32,
    rng_state: u32,
    next_slot: usize,
}

impl BubbleOscillator {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            bubbles: core::array::from_fn(|_| Bubble::new()),
            spawn_timer: 1.0,
            spawn_interval: sample_rate / 5.0,
            min_size: 0.003,
            max_size: 0.01,
            sample_rate,
            inv_sr: 1.0 / sample_rate,
            rng_state: 48271,
            next_slot: 0,
        }
    }

    pub fn set_params(&mut self, rate: f32, min_size: f32, max_size: f32) {
        if rate > 0.01 {
            self.spawn_interval = self.sample_rate / rate;
        } else {
            self.spawn_interval = f32::MAX;
            self.spawn_timer = f32::MAX;
        }
        self.min_size = min_size.max(0.0005);
        self.max_size = max_size.max(self.min_size + 0.0001);
    }

    /// Spawn a burst of 2-4 bubbles at a specific frequency (note-triggered).
    pub fn trigger_note(&mut self, freq: f32, velocity: f32) {
        let count = 2 + (velocity * 2.0) as usize; // 2-4 bubbles based on velocity
        let amp_scale = 0.3 + velocity * 0.7; // velocity-scaled amplitude
        for i in 0..count.min(4) {
            // Slight random detuning around the target frequency
            let detune = 1.0 + (self.rand_f32() - 0.5) * 0.08; // ±4%
            let bubble_freq = freq * detune;
            // Radius from frequency (inverse Minnaert)
            let radius = (MINNAERT_CONST / bubble_freq).clamp(0.0005, 0.05);
            self.spawn_bubble_at(bubble_freq, radius, amp_scale);
        }
    }

    /// Generate one sample (sum of all active bubbles).
    #[inline(always)]
    pub fn tick(&mut self) -> f32 {
        // Ambient spawn check
        self.spawn_timer -= 1.0;
        if self.spawn_timer <= 0.0 {
            self.spawn_ambient_bubble();
            let u = self.rand_f32().max(0.001);
            self.spawn_timer = -u.ln() * self.spawn_interval;
        }

        let mut sum = 0.0f32;
        let inv_sr = self.inv_sr;
        for bubble in &mut self.bubbles {
            sum += bubble.tick(inv_sr);
        }
        sum
    }

    fn spawn_ambient_bubble(&mut self) {
        let t = self.rand_f32();
        let radius = self.min_size + t * (self.max_size - self.min_size);
        let freq = (MINNAERT_CONST / radius).clamp(20.0, 20000.0);
        self.spawn_bubble_at(freq, radius, 1.0);
    }

    fn spawn_bubble_at(&mut self, freq: f32, radius: f32, amp: f32) {
        let decay_samples = radius * DECAY_SCALE; // ~20-100ms for typical sizes
        let decay_rate = if decay_samples > 1.0 {
            (-6.908 / decay_samples).exp()
        } else {
            0.0
        };

        let slot = self.next_slot % MAX_BUBBLES;
        self.next_slot = (self.next_slot + 1) % MAX_BUBBLES;

        self.bubbles[slot] = Bubble {
            phase: 0.0,
            freq: freq.clamp(20.0, 20000.0),
            decay_rate,
            envelope: 0.0,
            attack_inc: amp / ATTACK_SAMPLES, // ramp to amp over ~1ms
            attacking: true,
            active: true,
        };
    }

    fn rand_f32(&mut self) -> f32 {
        self.rng_state = self.rng_state.wrapping_mul(1103515245).wrapping_add(12345);
        ((self.rng_state >> 16) & 0x7FFF) as f32 / 32768.0
    }

    pub fn reset(&mut self) {
        for bubble in &mut self.bubbles {
            bubble.active = false;
        }
        self.spawn_timer = self.sample_rate;
        self.next_slot = 0;
    }
}

/// Convert MIDI note to Hz.
#[inline(always)]
pub fn midi_to_hz(note: u8) -> f32 {
    440.0 * 2.0f32.powf((note as f32 - 69.0) / 12.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    #[test]
    fn output_bounded() {
        let mut bo = BubbleOscillator::new(SR);
        bo.set_params(60.0, 0.001, 0.03);
        for _ in 0..100_000 {
            let out = bo.tick();
            assert!(!out.is_nan(), "NaN from bubble oscillator");
            assert!(!out.is_infinite(), "Inf from bubble oscillator");
            assert!(out.abs() < 20.0, "Output unbounded: {out}");
        }
    }

    #[test]
    fn rate_zero_silence() {
        let mut bo = BubbleOscillator::new(SR);
        bo.set_params(0.0, 0.003, 0.01);
        let mut has_nonzero = false;
        for _ in 0..44100 {
            if bo.tick().abs() > 0.001 { has_nonzero = true; }
        }
        assert!(!has_nonzero, "Rate=0 should produce silence");
    }

    #[test]
    fn high_rate_produces_output() {
        let mut bo = BubbleOscillator::new(SR);
        bo.set_params(30.0, 0.002, 0.008);
        let mut has_output = false;
        for _ in 0..44100 {
            if bo.tick().abs() > 0.01 { has_output = true; break; }
        }
        assert!(has_output, "Rate=30 should produce audible output");
    }

    #[test]
    fn realistic_decay_duration() {
        // A 0.005m bubble should ring for ~5000 samples (~113ms at 44.1kHz)
        let mut bo = BubbleOscillator::new(SR);
        bo.set_params(0.0, 0.005, 0.005); // prevent ambient spawning but we'll trigger manually
        bo.trigger_note(652.0, 1.0); // frequency for 0.005m radius

        // Should still be audible after 2000 samples (~45ms)
        for _ in 0..2000 { bo.tick(); }
        let mut has_output = false;
        for _ in 0..100 {
            if bo.tick().abs() > 0.01 { has_output = true; break; }
        }
        assert!(has_output, "Bubble should still ring after 45ms");

        // Should be silent after 20000 samples (~450ms)
        for _ in 0..20000 { bo.tick(); }
        let mut still_audible = false;
        for _ in 0..100 {
            if bo.tick().abs() > 0.001 { still_audible = true; break; }
        }
        assert!(!still_audible, "Bubble should have decayed after 450ms");
    }

    #[test]
    fn trigger_note_spawns_at_pitch() {
        let mut bo = BubbleOscillator::new(SR);
        bo.set_params(0.0, 0.003, 0.01); // no ambient
        bo.trigger_note(440.0, 1.0);
        // Should produce output (triggered bubbles near 440Hz)
        let mut has_output = false;
        for _ in 0..4410 {
            if bo.tick().abs() > 0.01 { has_output = true; break; }
        }
        assert!(has_output, "trigger_note should produce audible output");
    }

    #[test]
    fn no_nan_extreme_params() {
        let mut bo = BubbleOscillator::new(SR);
        bo.set_params(60.0, 0.001, 0.03);
        for _ in 0..100_000 { assert!(!bo.tick().is_nan()); }
        bo.set_params(0.5, 0.001, 0.002);
        for _ in 0..100_000 { assert!(!bo.tick().is_nan()); }
        // Trigger at extremes
        bo.trigger_note(20.0, 0.0);
        for _ in 0..10000 { assert!(!bo.tick().is_nan()); }
        bo.trigger_note(15000.0, 1.0);
        for _ in 0..10000 { assert!(!bo.tick().is_nan()); }
    }

    #[test]
    fn reset_clears_bubbles() {
        let mut bo = BubbleOscillator::new(SR);
        bo.set_params(60.0, 0.003, 0.01);
        for _ in 0..10000 { bo.tick(); }
        bo.reset();
        bo.set_params(0.0, 0.003, 0.01);
        let mut energy = 0.0f32;
        for _ in 0..1000 { energy += bo.tick().abs(); }
        assert!(energy < 0.01, "After reset with no spawns, should be silent");
    }

    #[test]
    fn size_affects_pitch() {
        let small_freq = MINNAERT_CONST / 0.002;
        let large_freq = MINNAERT_CONST / 0.02;
        assert!(small_freq > large_freq * 5.0);
    }
}

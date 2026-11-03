use jelly_audio::engine::{Engine, BLOCK_FRAMES, CHANNELS, OUTPUT_LEN};
use jelly_audio::params::*;

const SR: f32 = 48_000.0;
const SETTLE_S: f32 = 4.0; // > 6 glide time constants
fn blocks_for(s: f32) -> usize { (s * SR / BLOCK_FRAMES as f32).ceil() as usize }

fn base() -> [f32; PARAM_COUNT] {
    let mut p = [0.0; PARAM_COUNT];
    for v in 0..VOICES { p[v * PER_VOICE + V_FREQ] = 110.0; }
    p[P_MASTER] = 1.0;
    p[P_BREATH] = 0.5;
    p[P_SQUISH_PITCH] = 500.0;
    p[P_PLOP_PITCH] = 800.0;
    p
}

fn render(e: &mut Engine, p: &[f32; PARAM_COUNT], seconds: f32) -> Vec<f32> {
    let mut out = [0.0f32; OUTPUT_LEN];
    let mut left = Vec::new();
    for _ in 0..blocks_for(seconds) {
        e.apply_params(p);
        e.render(&mut out);
        left.extend((0..BLOCK_FRAMES).map(|f| out[f * CHANNELS]));
    }
    left
}

fn rms(s: &[f32]) -> f32 { (s.iter().map(|x| x * x).sum::<f32>() / s.len().max(1) as f32).sqrt() }

/// Goertzel power at frequency f.
fn power_at(s: &[f32], f: f32) -> f32 {
    let w = core::f32::consts::TAU * f / SR;
    let c = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f32, 0.0f32);
    for &x in s { let s0 = x + c * s1 - s2; s2 = s1; s1 = s0; }
    s1 * s1 + s2 * s2 - c * s1 * s2
}

#[test]
fn one_voice_sounds_at_its_frequency() {
    let mut e = Engine::new(SR);
    let mut p = base();
    p[V_FREQ] = 220.0; p[V_GAIN] = 1.0;
    render(&mut e, &p, SETTLE_S); // voices glide from their default pitch
    let s = render(&mut e, &p, 1.0);
    let at = power_at(&s, 220.0);
    for off in [190.0, 205.0, 235.0, 250.0] {
        assert!(at > 20.0 * power_at(&s, off), "220 Hz not dominant vs {off}");
    }
}

#[test]
fn harmonic_variation_between_voices() {
    // Same pitch, different voices: different harmonic recipes -> different 3rd-harmonic share.
    let share = |voice: usize| {
        let mut e = Engine::new(SR);
        let mut p = base();
        p[voice * PER_VOICE + V_FREQ] = 200.0; p[voice * PER_VOICE + V_GAIN] = 1.0;
        render(&mut e, &p, SETTLE_S);
        let s = render(&mut e, &p, 1.0);
        power_at(&s, 600.0) / power_at(&s, 200.0)
    };
    let (a, b) = (share(0), share(1));
    assert!(b > a * 2.0, "voices should differ in harmonic recipe: {a} vs {b}");
}

#[test]
fn pitch_glides_smoothly_no_clicks() {
    let mut e = Engine::new(SR);
    let mut p = base();
    p[V_FREQ] = 300.0; p[V_GAIN] = 1.0;
    render(&mut e, &p, 1.0);
    p[V_FREQ] = 120.0; p[V_GAIN] = 0.2; // a merge: lower and quieter at once
    let s = render(&mut e, &p, SETTLE_S);
    let max_step = s.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max);
    assert!(max_step < 0.08, "discontinuity {max_step}");
    let mid = e.voice_frequency(0);
    assert!((mid - 120.0).abs() < 25.0, "glide did not arrive: {mid}");
}

#[test]
fn squish_is_audible_and_follows_its_pitch() {
    let measure = |amount: f32, pitch: f32| {
        let mut e = Engine::new(SR);
        let mut p = base();
        p[P_SQUISH] = amount; p[P_SQUISH_PITCH] = pitch;
        render(&mut e, &p, 0.3);
        let s = render(&mut e, &p, 1.0);
        let crossings = s.windows(2).filter(|w| (w[0] >= 0.0) != (w[1] >= 0.0)).count();
        (rms(&s), crossings)
    };
    let (quiet, _) = measure(0.0, 500.0);
    let (loud, low_x) = measure(1.0, 300.0);
    let (_, high_x) = measure(1.0, 1500.0);
    assert!(quiet < 1e-4 && loud > 0.02, "squish level: off {quiet}, on {loud}");
    assert!(high_x as f32 > low_x as f32 * 2.0, "squish pitch: {low_x} -> {high_x} crossings");
}

#[test]
fn plop_is_a_short_drop_with_rising_pitch() {
    let mut e = Engine::new(SR);
    let mut p = base();
    p[P_PLOP_GAIN] = 1.0; p[P_PLOP_PITCH] = 600.0;
    render(&mut e, &p, 0.1);
    p[P_PLOP_COUNT] = 1.0;
    let s = render(&mut e, &p, 0.6);
    let ms = |m: f32| (m / 1000.0 * SR) as usize;
    let early = rms(&s[ms(0.0)..ms(60.0)]);
    let late = rms(&s[ms(400.0)..ms(550.0)]);
    assert!(early > 0.02 && late < early * 0.02, "not a short drop: early {early}, late {late}");
    let x = |a: f32, b: f32| s[ms(a)..ms(b)].windows(2).filter(|w| (w[0] >= 0.0) != (w[1] >= 0.0)).count() as f32 / ((b - a) / 1000.0);
    let (start, after) = (x(4.0, 14.0), x(50.0, 90.0));
    assert!(after > start * 1.4, "pitch should rise: {start} -> {after} crossings/s");
    // A second plop only on the next increment.
    let quiet = render(&mut e, &p, 0.3);
    assert!(rms(&quiet) < 1e-3, "plop retriggered without a new count");
}

#[test]
fn bounded_and_finite_with_garbage() {
    for fill in [f32::NAN, 1e9, -1e9, 0.0] {
        let mut e = Engine::new(SR);
        let mut p = [fill; PARAM_COUNT];
        for k in 0..16 { p[P_PLOP_COUNT] = k as f32 * 3.0; let s = render(&mut e, &p, 0.05);
            assert!(s.iter().all(|x| x.is_finite() && x.abs() <= 1.0), "bad sample with fill {fill}"); }
    }
}

#[test]
fn master_zero_is_silent() {
    let mut e = Engine::new(SR);
    let mut p = base();
    p[P_MASTER] = 0.0; p[V_GAIN] = 1.0; p[P_SQUISH] = 1.0;
    let s = render(&mut e, &p, 1.0);
    assert!(rms(&s[s.len() / 2..]) < 1e-5);
}

#[test]
#[ignore]
fn report_spectrum_220() {
    let mut e = Engine::new(SR);
    let mut p = base();
    p[V_FREQ] = 220.0; p[V_GAIN] = 1.0;
    render(&mut e, &p, 1.0);
    let s = render(&mut e, &p, 1.0);
    for f in [180.0, 190.0, 200.0, 205.0, 210.0, 215.0, 219.0, 220.0, 221.0, 225.0, 235.0, 440.0] {
        println!("{f:6.1} Hz power {:.3e}", power_at(&s, f));
    }
    println!("peak {}", s.iter().fold(0.0f32, |m, x| m.max(x.abs())));
}

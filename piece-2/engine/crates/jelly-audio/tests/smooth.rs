//! Owner: "the harsh record scratching sound is ... the exact polar opposite of
//! smooth jellies". The effects must be smooth: tonal (not noise), free of
//! rough fast amplitude flutter, and without broadband clicks.
use jelly_audio::engine::{Engine, BLOCK_FRAMES, CHANNELS, OUTPUT_LEN};
use jelly_audio::params::*;

const SR: f32 = 48_000.0;
const N: usize = 4096;
const MAX_FLATNESS: f32 = 0.05;      // spectral flatness: white noise ~0.6+, a pure tone ~0
const MAX_ROUGHNESS: f32 = 0.08;     // envelope energy in the 15-80 Hz "roughness" band, relative
const MAX_HF_SHARE: f32 = 0.02;      // share of energy above 5 kHz

fn base() -> [f32; PARAM_COUNT] {
    let mut p = [0.0; PARAM_COUNT];
    for v in 0..VOICES { p[v * PER_VOICE + V_FREQ] = 110.0; }
    p[P_MASTER] = 1.0;
    p[P_SQUISH_PITCH] = 500.0;
    p[P_PLOP_PITCH] = 800.0;
    p
}

fn render(e: &mut Engine, p: &[f32; PARAM_COUNT], frames: usize) -> Vec<f32> {
    let mut out = [0.0f32; OUTPUT_LEN];
    let mut v = Vec::new();
    while v.len() < frames {
        e.apply_params(p);
        e.render(&mut out);
        v.extend((0..BLOCK_FRAMES).map(|f| out[f * CHANNELS]));
    }
    v.truncate(frames);
    v
}

/// Power spectrum (Hann window, naive DFT over N samples).
fn spectrum(s: &[f32]) -> Vec<f32> {
    let n = s.len();
    (1..n / 2).map(|k| {
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (i, &x) in s.iter().enumerate() {
            let w = 0.5 - 0.5 * (core::f64::consts::TAU * i as f64 / n as f64).cos();
            let a = core::f64::consts::TAU * (k * i) as f64 / n as f64;
            re += x as f64 * w * a.cos();
            im -= x as f64 * w * a.sin();
        }
        (re * re + im * im) as f32
    }).collect()
}

fn flatness(p: &[f32]) -> f32 {
    let p: Vec<f32> = p.iter().map(|x| x + 1e-20).collect();
    let geo = (p.iter().map(|x| (*x as f64).ln()).sum::<f64>() / p.len() as f64).exp();
    let arith = p.iter().map(|x| *x as f64).sum::<f64>() / p.len() as f64;
    (geo / arith) as f32
}

fn hf_share(p: &[f32]) -> f32 {
    let hz = SR / N as f32;
    let cut = (5000.0 / hz) as usize;
    p[cut..].iter().sum::<f32>() / p.iter().sum::<f32>().max(1e-20)
}

/// Fast amplitude flutter: energy of the envelope in 15-80 Hz relative to its mean.
fn roughness(s: &[f32]) -> f32 {
    // 10 ms RMS window, hopped every 1 ms: long enough to span several periods of
    // the tone (a 1 ms window ripples with the waveform itself and aliases into
    // the band), short enough to catch 15-80 Hz flutter.
    let win = (SR / 100.0) as usize;
    let hop = (SR / 1000.0) as usize;
    let env: Vec<f32> = (0..s.len().saturating_sub(win)).step_by(hop)
        .map(|i| (s[i..i + win].iter().map(|x| x * x).sum::<f32>() / win as f32).sqrt()).collect();
    let mean = env.iter().sum::<f32>() / env.len() as f32;
    let n = env.len();
    let er = 1000.0; // envelope sample rate
    let mut band = 0.0f32;
    for k in 1..n / 2 {
        let f = k as f32 * er / n as f32;
        if !(15.0..=80.0).contains(&f) { continue; }
        let (mut re, mut im) = (0.0f32, 0.0f32);
        for (i, &x) in env.iter().enumerate() {
            // Hann window: without it, slow smooth movement (chorus, the gentle
            // vibrato) leaks into the 15-80 Hz bins and reads as flutter.
            let w = 0.5 - 0.5 * (core::f32::consts::TAU * i as f32 / n as f32).cos();
            let a = core::f32::consts::TAU * (k * i) as f32 / n as f32;
            re += (x - mean) * w * a.cos(); im -= (x - mean) * w * a.sin();
        }
        band += (re * re + im * im).sqrt() / n as f32;
    }
    band / mean.max(1e-9)
}

#[test]
fn squish_is_smooth_not_scratchy() {
    let mut e = Engine::new(SR);
    let mut p = base();
    p[P_SQUISH] = 0.8;
    render(&mut e, &p, (SR * 0.5) as usize);
    let s = render(&mut e, &p, (SR * 1.0) as usize);
    let spec = spectrum(&s[..N]);
    let (fl, rough, hf) = (flatness(&spec), roughness(&s), hf_share(&spec));
    println!("squish: flatness {fl:.3} roughness {rough:.3} hf {hf:.4}");
    assert!(fl < MAX_FLATNESS, "squish is noisy (flatness {fl:.3})");
    assert!(rough < MAX_ROUGHNESS, "squish flutters (roughness {rough:.3})");
    assert!(hf < MAX_HF_SHARE, "squish is hissy (HF share {hf:.4})");
}

#[test]
fn plop_has_no_click() {
    let mut e = Engine::new(SR);
    let mut p = base();
    p[P_PLOP_GAIN] = 1.0;
    render(&mut e, &p, BLOCK_FRAMES * 4);
    p[P_PLOP_COUNT] = 1.0;
    let s = render(&mut e, &p, N);
    let spec = spectrum(&s);
    let hf = hf_share(&spec);
    // A click is an onset sharper than the tone that follows it. (A loud sine
    // steps a lot per sample on its own, so compare against the steady part.)
    let step = |a: usize, b: usize| s[a..b].windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max);
    let ms = |m: f32| (m / 1000.0 * SR) as usize;
    let (onset, steady) = (step(0, ms(2.0)), step(ms(10.0), ms(20.0)));
    println!("plop: hf {hf:.4} onset step {onset:.4} steady step {steady:.4}");
    assert!(hf < MAX_HF_SHARE, "plop has a broadband click (HF share {hf:.4})");
    assert!(onset <= steady * 1.2, "plop onset is sharper than its tone: a click ({onset:.4} vs {steady:.4})");
}

//! Glints must stay "unarticulable" (brief, Sound): rare, soft swells that sit
//! under the drone. These tests reproduce the user's report that the glints
//! were "really annoying chirping": too many, too sharp, too loud.
mod common;
use common::*;
use xiu_dsp::drone::{Engine, BLOCK_FRAMES, CHANNELS, OUTPUT_LEN};
use xiu_dsp::params::*;

const MEASURE_SECONDS: f32 = 20.0;
const WINDOW_S: f32 = 0.005;
const BASELINE_S: f32 = 0.06;
const ONSET_JUMP_DB: f32 = 6.0;
const ONSET_REFRACTORY_S: f32 = 0.08;
const MAX_ONSETS_PER_S: f32 = 4.0;
const MAX_LEVEL_RISE_DB: f32 = 1.5;

/// A dark, quiet drone so glints are as exposed as they will ever be.
fn exposed_params(convergence: f32) -> [f32; PARAM_COUNT] {
    let mut p = neutral_params();
    p[P_BREATH] = 0.0;
    p[P_ALTITUDE] = 0.0;
    p[P_AGITATION] = 0.0;
    p[P_CONVERGENCE] = convergence;
    p
}

fn render_left(params: [f32; PARAM_COUNT], seconds: f32) -> Vec<f32> {
    let mut e = Engine::new(SAMPLE_RATE);
    e.apply_params(&params);
    let mut out = [0.0f32; OUTPUT_LEN];
    for _ in 0..blocks_for(SETTLE_SECONDS) {
        e.render(&mut out);
    }
    let mut left = Vec::new();
    for _ in 0..blocks_for(seconds) {
        e.render(&mut out);
        left.extend((0..BLOCK_FRAMES).map(|f| out[f * CHANNELS]));
    }
    left
}

/// Count sharp rises in high-frequency energy (first difference) per second.
fn onsets_per_second(signal: &[f32]) -> f32 {
    let win = (WINDOW_S * SAMPLE_RATE) as usize;
    let energy: Vec<f32> = signal
        .windows(2)
        .map(|w| (w[1] - w[0]) * (w[1] - w[0]))
        .collect::<Vec<_>>()
        .chunks(win)
        .map(|c| c.iter().sum::<f32>() / c.len() as f32 + 1e-20)
        .collect();
    let base_len = (BASELINE_S / WINDOW_S) as usize;
    let refractory = (ONSET_REFRACTORY_S / WINDOW_S) as usize;
    let (mut count, mut last) = (0usize, 0usize);
    for i in base_len..energy.len() {
        let base = energy[i - base_len..i].iter().sum::<f32>() / base_len as f32;
        let jump_db = 10.0 * (energy[i] / base).log10();
        if jump_db > ONSET_JUMP_DB && i - last > refractory {
            count += 1;
            last = i;
        }
    }
    count as f32 / MEASURE_SECONDS
}

fn rms(s: &[f32]) -> f32 {
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

#[test]
fn glints_are_rare_even_at_full_convergence() {
    let rate = onsets_per_second(&render_left(exposed_params(1.0), MEASURE_SECONDS));
    assert!(rate <= MAX_ONSETS_PER_S, "{rate:.1} sharp onsets/s (max {MAX_ONSETS_PER_S})");
}

#[test]
fn glints_sit_under_the_drone() {
    let calm = rms(&render_left(exposed_params(0.0), MEASURE_SECONDS));
    let full = rms(&render_left(exposed_params(1.0), MEASURE_SECONDS));
    let rise_db = 20.0 * (full / calm).log10();
    assert!(rise_db <= MAX_LEVEL_RISE_DB, "glints raise the mix by {rise_db:.1} dB (max {MAX_LEVEL_RISE_DB})");
}

#[test]
fn glints_are_still_present() {
    // Taming must not mean deleting. Total RMS barely moves when an uncorrelated
    // sound is added, so measure the glints themselves (the difference between
    // renders with and without them) against the drone.
    const MIN_RELATIVE_DB: f32 = -14.0;
    const MAX_RELATIVE_DB: f32 = -6.0;
    let calm = render_left(exposed_params(0.0), MEASURE_SECONDS);
    let full = render_left(exposed_params(1.0), MEASURE_SECONDS);
    let glints: Vec<f32> = full.iter().zip(&calm).map(|(a, b)| a - b).collect();
    let rel_db = 20.0 * (rms(&glints) / rms(&calm)).log10();
    assert!(rel_db >= MIN_RELATIVE_DB, "glints too quiet to hear: {rel_db:.1} dB vs drone");
    assert!(rel_db <= MAX_RELATIVE_DB, "glints too prominent: {rel_db:.1} dB vs drone");
}

/// Diagnostic: `cargo test --release --test glints -- --ignored --nocapture`
#[test]
#[ignore]
fn report_glint_metrics() {
    let calm = render_left(exposed_params(0.0), MEASURE_SECONDS);
    let full = render_left(exposed_params(1.0), MEASURE_SECONDS);
    println!("onsets/s calm={:.2} full={:.2}", onsets_per_second(&calm), onsets_per_second(&full));
    println!("rms calm={:.5} full={:.5} rise={:.2} dB", rms(&calm), rms(&full), 20.0 * (rms(&full) / rms(&calm)).log10());
    let diff: Vec<f32> = full.iter().zip(&calm).map(|(a, b)| a - b).collect();
    println!("glint-only (difference) rms={:.5} peak={:.4}", rms(&diff), diff.iter().fold(0.0f32, |m, x| m.max(x.abs())));
}

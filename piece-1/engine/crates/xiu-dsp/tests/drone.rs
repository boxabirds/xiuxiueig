mod common;
use common::*;
use xiu_dsp::drone::{Engine, OUTPUT_LEN};
use xiu_dsp::params::*;

const MEASURE_SECONDS: f32 = 4.0;
const AUDIBLE_RMS: f32 = 0.01;
const OUTPUT_LIMIT: f32 = 1.0;

#[test]
fn output_is_audible_with_neutral_params() {
    let (rms, _) = measure(neutral_params(), MEASURE_SECONDS);
    assert!(rms > AUDIBLE_RMS, "drone too quiet: rms={rms}");
}

#[test]
fn master_zero_is_silent() {
    let mut p = neutral_params();
    p[P_MASTER] = 0.0;
    let (rms, _) = measure(p, MEASURE_SECONDS);
    assert!(rms < 1e-4, "expected silence, rms={rms}");
}

#[test]
fn breath_swells_the_drone() {
    let mut lo = neutral_params();
    lo[P_BREATH] = 0.0;
    let mut hi = neutral_params();
    hi[P_BREATH] = 1.0;
    let (rms_lo, _) = measure(lo, MEASURE_SECONDS);
    let (rms_hi, _) = measure(hi, MEASURE_SECONDS);
    assert!(rms_hi > rms_lo * 1.5, "inhale should be clearly louder: {rms_lo} -> {rms_hi}");
}

#[test]
fn altitude_opens_the_filter() {
    let mut low = neutral_params();
    low[P_ALTITUDE] = 0.0;
    low[P_CONVERGENCE] = 0.0;
    let mut high = low;
    high[P_ALTITUDE] = 1.0;
    let (rms_l, diff_l) = measure(low, MEASURE_SECONDS);
    let (rms_h, diff_h) = measure(high, MEASURE_SECONDS);
    // Normalise by level so this measures brightness, not loudness.
    let bright_l = diff_l / rms_l;
    let bright_h = diff_h / rms_h;
    assert!(bright_h > bright_l * 1.3, "high altitude should be brighter: {bright_l} -> {bright_h}");
}

#[test]
fn convergence_adds_glints() {
    let mut calm = neutral_params();
    calm[P_CONVERGENCE] = 0.0;
    calm[P_ALTITUDE] = 0.0;
    calm[P_BREATH] = 0.0;
    let mut focused = calm;
    focused[P_CONVERGENCE] = 1.0;
    let (_, diff_c) = measure(calm, MEASURE_SECONDS);
    let (_, diff_f) = measure(focused, MEASURE_SECONDS);
    assert!(diff_f > diff_c * 1.2, "glints should add high-frequency energy: {diff_c} -> {diff_f}");
}

#[test]
fn bounded_and_finite_under_extreme_and_garbage_params() {
    let cases: [[f32; PARAM_COUNT]; 4] = [
        [1.0; PARAM_COUNT],
        [0.0; PARAM_COUNT],
        [1e9, -1e9, 1e9, -1e9, 1e9, 1e9, 1e9, 1e9, 1e9, 1e9, 1e9, -1e9],
        [f32::NAN; PARAM_COUNT],
    ];
    for params in cases {
        let mut e = Engine::new(SAMPLE_RATE);
        e.apply_params(&params);
        let mut out = [0.0f32; OUTPUT_LEN];
        for _ in 0..blocks_for(MEASURE_SECONDS) {
            e.render(&mut out);
            for s in out {
                assert!(s.is_finite(), "non-finite sample for {params:?}");
                assert!(s.abs() <= OUTPUT_LIMIT, "sample {s} out of range for {params:?}");
            }
        }
    }
}

#[test]
fn stays_stable_over_a_long_run_with_moving_params() {
    const LONG_SECONDS: f32 = 90.0;
    const MOD_RATE: f32 = 0.37;
    let mut e = Engine::new(SAMPLE_RATE);
    let mut out = [0.0f32; OUTPUT_LEN];
    let blocks = blocks_for(LONG_SECONDS);
    let mut tail_sq = 0.0f64;
    let mut tail_n = 0usize;
    for b in 0..blocks {
        let t = b as f32 / blocks as f32 * LONG_SECONDS;
        let mut p = neutral_params();
        for (i, v) in p.iter_mut().enumerate() {
            if i != P_MASTER {
                *v = 0.5 + 0.5 * (t * MOD_RATE * (i as f32 + 1.0)).sin();
            }
        }
        e.apply_params(&p);
        e.render(&mut out);
        assert!(out.iter().all(|s| s.is_finite() && s.abs() <= OUTPUT_LIMIT));
        if b > blocks - blocks_for(MEASURE_SECONDS) {
            tail_sq += out.iter().map(|s| (s * s) as f64).sum::<f64>();
            tail_n += OUTPUT_LEN;
        }
    }
    let tail_rms = (tail_sq / tail_n as f64).sqrt() as f32;
    assert!(tail_rms > AUDIBLE_RMS, "engine died during long run: rms={tail_rms}");
}

#[test]
fn era_density_darkens_the_drone() {
    let mut thin = neutral_params();
    thin[P_ERA_DENSITY] = 0.0;
    thin[P_CONVERGENCE] = 0.0;
    let mut thick = thin;
    thick[P_ERA_DENSITY] = 1.0;
    let (rms_t, diff_t) = measure(thin, MEASURE_SECONDS);
    let (rms_k, diff_k) = measure(thick, MEASURE_SECONDS);
    assert!(diff_k / rms_k < (diff_t / rms_t) * 0.85, "thick era should be darker: {} -> {}", diff_t / rms_t, diff_k / rms_k);
}

#[test]
fn era_root_transposes_the_drone() {
    // Same seed and params except the era root, so voice ratios match and the
    // frequency ratio must be the configured transposition (7 semitones end to end).
    const EXPECTED: f32 = 1.498_307; // 2^(7/12)
    const TOLERANCE: f32 = 0.01;
    let render = |root: f32| {
        let mut p = neutral_params();
        p[P_ERA_ROOT] = root;
        let mut e = Engine::new(SAMPLE_RATE);
        e.apply_params(&p);
        let mut out = [0.0f32; OUTPUT_LEN];
        for _ in 0..blocks_for(1.0) { e.render(&mut out); }
        e
    };
    let (lo, hi) = (render(0.0), render(1.0));
    for v in 0..6 {
        let ratio = hi.voice_frequency(v) / lo.voice_frequency(v);
        assert!((ratio - EXPECTED).abs() < EXPECTED * TOLERANCE, "voice {v}: ratio {ratio}");
    }
}

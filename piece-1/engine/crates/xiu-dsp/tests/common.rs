// Shared helpers for engine tests.
#![allow(dead_code)]
use xiu_dsp::drone::{Engine, BLOCK_FRAMES, CHANNELS, OUTPUT_LEN};
use xiu_dsp::params::*;

pub const SAMPLE_RATE: f32 = 48_000.0;
pub const SETTLE_SECONDS: f32 = 2.0;

pub fn blocks_for(seconds: f32) -> usize {
    (seconds * SAMPLE_RATE / BLOCK_FRAMES as f32).ceil() as usize
}

pub fn neutral_params() -> [f32; PARAM_COUNT] {
    let mut p = [0.0; PARAM_COUNT];
    p[P_BREATH] = 0.5;
    p[P_MISREG] = 0.3;
    p[P_AGITATION] = 0.3;
    p[P_ALTITUDE] = 0.5;
    p[P_SPREAD] = 0.8;
    p[P_CONVERGENCE] = 0.3;
    p[P_MASTER] = 1.0;
    p[P_ERA_ROOT] = 0.5;
    p[P_ERA_DENSITY] = 0.3;
    p
}

/// Render `seconds` after a settle period; returns (rms, mean |first difference|),
/// the second being a brightness proxy (high-frequency energy).
pub fn measure(params: [f32; PARAM_COUNT], seconds: f32) -> (f32, f32) {
    let mut e = Engine::new(SAMPLE_RATE);
    e.apply_params(&params);
    let mut out = [0.0f32; OUTPUT_LEN];
    for _ in 0..blocks_for(SETTLE_SECONDS) {
        e.render(&mut out);
    }
    let (mut sq, mut diff, mut n) = (0.0f64, 0.0f64, 0usize);
    let mut prev = 0.0f32;
    for _ in 0..blocks_for(seconds) {
        e.render(&mut out);
        for f in 0..BLOCK_FRAMES {
            let s = out[f * CHANNELS];
            sq += (s * s) as f64;
            diff += (s - prev).abs() as f64;
            prev = s;
            n += 1;
        }
    }
    ((sq / n as f64).sqrt() as f32, (diff / n as f64) as f32)
}

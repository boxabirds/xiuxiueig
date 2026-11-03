//! Offline render for listening and inspection:
//! cargo run --release --example render_wav -- out.wav [seconds]
use std::io::Write;
use xiu_dsp::drone::{Engine, BLOCK_FRAMES, CHANNELS, OUTPUT_LEN};
use xiu_dsp::params::*;

const SAMPLE_RATE: u32 = 48_000;
const DEFAULT_SECONDS: f32 = 40.0;
const BREATH_PERIOD_S: f32 = 13.0;
const WOBBLE_HZ: [f32; WOBBLE_COUNT] = [0.071, 0.113, 0.179];
const FADE_IN_S: f32 = 6.0;
const I16_SCALE: f32 = 32767.0;
const REPORT_INTERVAL_S: f32 = 2.0;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args.get(1).cloned().unwrap_or_else(|| "xiu.wav".into());
    let seconds: f32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(DEFAULT_SECONDS);
    let mut engine = Engine::new(SAMPLE_RATE as f32);
    let mut out = [0.0f32; OUTPUT_LEN];
    let blocks = (seconds * SAMPLE_RATE as f32 / BLOCK_FRAMES as f32) as usize;
    let mut pcm: Vec<i16> = Vec::with_capacity(blocks * OUTPUT_LEN);
    let (mut sq, mut peak, mut n) = (0.0f64, 0.0f32, 0usize);
    for b in 0..blocks {
        let t = (b * BLOCK_FRAMES) as f32 / SAMPLE_RATE as f32;
        let tau = std::f32::consts::TAU;
        let mut p = [0.0f32; PARAM_COUNT];
        p[P_BREATH] = 0.5 - 0.5 * (tau * t / BREATH_PERIOD_S).cos();
        for (k, hz) in WOBBLE_HZ.iter().enumerate() {
            p[WOBBLE_PARAMS[k]] = (tau * hz * t).sin();
        }
        p[P_MISREG] = 0.3 + 0.3 * (t * 0.05).sin();
        p[P_AGITATION] = 0.3 + 0.3 * (t * 0.031).sin();
        p[P_ALTITUDE] = 0.5 + 0.3 * (t * 0.023).sin();
        p[P_SPREAD] = 0.8;
        p[P_CONVERGENCE] = 0.5 + 0.5 * (t * 0.09).sin();
        p[P_MASTER] = (t / FADE_IN_S).min(1.0);
        engine.apply_params(&p);
        engine.render(&mut out);
        for s in out {
            sq += (s * s) as f64;
            peak = peak.max(s.abs());
            n += 1;
            pcm.push((s * I16_SCALE) as i16);
        }
        let report_every = (REPORT_INTERVAL_S * SAMPLE_RATE as f32 / BLOCK_FRAMES as f32) as usize;
        if b % report_every == report_every - 1 {
            println!("t={:5.1}s breath={:.2} rms={:.4} peak={:.3}", t, p[P_BREATH], (sq / n as f64).sqrt(), peak);
            sq = 0.0; peak = 0.0; n = 0;
        }
    }
    let data_len = (pcm.len() * 2) as u32;
    let mut f = std::fs::File::create(&path).unwrap();
    let byte_rate = SAMPLE_RATE * CHANNELS as u32 * 2;
    f.write_all(b"RIFF").unwrap();
    f.write_all(&(36 + data_len).to_le_bytes()).unwrap();
    f.write_all(b"WAVEfmt ").unwrap();
    f.write_all(&16u32.to_le_bytes()).unwrap();
    f.write_all(&1u16.to_le_bytes()).unwrap();
    f.write_all(&(CHANNELS as u16).to_le_bytes()).unwrap();
    f.write_all(&SAMPLE_RATE.to_le_bytes()).unwrap();
    f.write_all(&byte_rate.to_le_bytes()).unwrap();
    f.write_all(&((CHANNELS * 2) as u16).to_le_bytes()).unwrap();
    f.write_all(&16u16.to_le_bytes()).unwrap();
    f.write_all(b"data").unwrap();
    f.write_all(&data_len.to_le_bytes()).unwrap();
    for s in pcm { f.write_all(&s.to_le_bytes()).unwrap(); }
    println!("wrote {path}");
}

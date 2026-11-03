//! Parameter block layout. Mirrors web/src/audio/params.js.
pub const VOICES: usize = 16;
pub const PER_VOICE: usize = 3; // freq (Hz), gain (0..1), pan (-1..1)
pub const V_FREQ: usize = 0;
pub const V_GAIN: usize = 1;
pub const V_PAN: usize = 2;
pub const P_MASTER: usize = VOICES * PER_VOICE; // 48
pub const P_BREATH: usize = P_MASTER + 1;
pub const P_SQUISH: usize = P_MASTER + 2;       // 0..1 contact / pass-through intensity
pub const P_SQUISH_PITCH: usize = P_MASTER + 3; // Hz, formant centre
pub const P_SQUISH_PAN: usize = P_MASTER + 4;
pub const P_PLOP_COUNT: usize = P_MASTER + 5;   // increments by one per plop
pub const P_PLOP_PITCH: usize = P_MASTER + 6;   // Hz, start pitch of the drop
pub const P_PLOP_PAN: usize = P_MASTER + 7;
pub const P_PLOP_GAIN: usize = P_MASTER + 8;
pub const PARAM_COUNT: usize = P_MASTER + 9;    // 57

pub const FREQ_MIN: f32 = 20.0;
pub const FREQ_MAX: f32 = 4000.0;

#[inline(always)]
pub fn sanitize(v: f32, lo: f32, hi: f32) -> f32 {
    if v.is_nan() { lo } else { v.clamp(lo, hi) }
}

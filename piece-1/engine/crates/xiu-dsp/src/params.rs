//! Shared parameter block layout. Mirrors `web/src/audio/params.js`.
//! Every value is a "shared signal" from the Score (see docs/design/brief.md).

pub const P_BREATH: usize = 0; // 0..1, 13 s cycle
pub const P_WOBBLE_0: usize = 1; // -1..1 at 0.071 Hz
pub const P_WOBBLE_1: usize = 2; // -1..1 at 0.113 Hz
pub const P_WOBBLE_2: usize = 3; // -1..1 at 0.179 Hz
pub const P_MISREG: usize = 4; // 0..1 misregistration: detune + chorus
pub const P_AGITATION: usize = 5; // 0..1 Benjolin depth
pub const P_ALTITUDE: usize = 6; // 0..1 filter opening
pub const P_SPREAD: usize = 7; // 0..1 stereo spread
pub const P_CONVERGENCE: usize = 8; // 0..1 glint density
pub const P_MASTER: usize = 9; // 0..1 master gain (fade-in / mute)
pub const P_ERA_ROOT: usize = 10; // 0..1 minute-scale drone transposition
pub const P_ERA_DENSITY: usize = 11; // 0..1 thick-jelly era: darker filter
pub const PARAM_COUNT: usize = 12;

pub const WOBBLE_COUNT: usize = 3;
pub const WOBBLE_PARAMS: [usize; WOBBLE_COUNT] = [P_WOBBLE_0, P_WOBBLE_1, P_WOBBLE_2];

/// Clamp a raw parameter into its legal range; NaN becomes the range minimum.
#[inline(always)]
pub fn sanitize(value: f32, min: f32, max: f32) -> f32 {
    if value.is_nan() {
        min
    } else {
        value.clamp(min, max)
    }
}

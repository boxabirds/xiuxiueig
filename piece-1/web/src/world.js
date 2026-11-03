// World constants shared by JS and GLSL (injected into shaders as #defines),
// so the viewer, the score and the signal distance field cannot disagree.
export const TAU = Math.PI * 2;

/** Base spatial frequency. Every spatial frequency in the field is an integer
 *  multiple of K0, so the world is exactly periodic in x/z with WORLD_PERIOD
 *  and the viewer position can wrap without a seam (no float drift). */
export const K0 = 1 / 64; // world period ~402 units: minutes of travel before any repeat
export const WORLD_PERIOD = TAU / K0;

export const BAND_BOTTOM = 0.8;
export const BAND_TOP = 7.5;
export const FLOOR_Y = 0;

export const BREATH_PERIOD_S = 13;
export const WOBBLE_HZ = Object.freeze([0.071, 0.113, 0.179]);

export const BASE_IOR = 1.35; // Jelly Baby

export function wrap(value, period) {
  const r = value % period;
  return r < 0 ? r + period : r;
}

export function glslDefines() {
  const f = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));
  return [
    `#define K0 ${f(K0)}`,
    `#define BAND_BOTTOM ${f(BAND_BOTTOM)}`,
    `#define BAND_TOP ${f(BAND_TOP)}`,
    `#define FLOOR_Y ${f(FLOOR_Y)}`,
  ].join('\n');
}

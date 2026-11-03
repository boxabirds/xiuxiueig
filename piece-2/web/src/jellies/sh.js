// Real, orthonormal spherical harmonics up to l = 4 (25 coefficients), in the
// standard (Sloan) ordering. A jelly's surface is r(dir) = sum c_k Y_k(dir).
// The GLSL twin lives in shaders/scene.frag (shY); keep the constants identical.
export const SH_COUNT = 25;

/** Evaluate all 25 basis functions at unit direction (x, y, z) into `out`. */
export function shBasis(x, y, z, out) {
  const x2 = x * x, y2 = y * y, z2 = z * z;
  out[0] = 0.282095;
  out[1] = 0.488603 * y; out[2] = 0.488603 * z; out[3] = 0.488603 * x;
  out[4] = 1.092548 * x * y; out[5] = 1.092548 * y * z; out[6] = 0.315392 * (3 * z2 - 1);
  out[7] = 1.092548 * x * z; out[8] = 0.546274 * (x2 - y2);
  out[9] = 0.590044 * y * (3 * x2 - y2); out[10] = 2.890611 * x * y * z; out[11] = 0.457046 * y * (5 * z2 - 1);
  out[12] = 0.373176 * z * (5 * z2 - 3); out[13] = 0.457046 * x * (5 * z2 - 1); out[14] = 1.445306 * z * (x2 - y2);
  out[15] = 0.590044 * x * (x2 - 3 * y2);
  out[16] = 2.503343 * x * y * (x2 - y2); out[17] = 1.770131 * y * z * (3 * x2 - y2); out[18] = 0.946175 * x * y * (7 * z2 - 1);
  out[19] = 0.669047 * y * z * (7 * z2 - 3); out[20] = 0.105786 * (35 * z2 * z2 - 30 * z2 + 3); out[21] = 0.669047 * x * z * (7 * z2 - 3);
  out[22] = 0.473087 * (x2 - y2) * (7 * z2 - 1); out[23] = 1.770131 * x * z * (x2 - 3 * y2);
  out[24] = 0.625836 * (x2 * (x2 - 3 * y2) - y2 * (3 * x2 - y2));
  return out;
}

const scratch = new Float64Array(SH_COUNT);

/** r(dir) from coefficients. Direction need not be normalised. */
export function shRadius(coeffs, x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  shBasis(x / l, y / l, z / l, scratch);
  let r = 0;
  for (let k = 0; k < SH_COUNT; k++) r += coeffs[k] * scratch[k];
  return r;
}

/** Project samples (unit dirs[i], radii[i], quadrature weights w[i]) onto the
 *  basis: c_k = sum_i w_i r_i Y_k(dir_i). Writes into `coeffs`. */
export function shFit(dirs, radii, weights, coeffs) {
  coeffs.fill(0);
  for (let i = 0; i < radii.length; i++) {
    shBasis(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2], scratch);
    const wr = weights[i] * radii[i];
    for (let k = 0; k < SH_COUNT; k++) coeffs[k] += wr * scratch[k];
  }
  return coeffs;
}

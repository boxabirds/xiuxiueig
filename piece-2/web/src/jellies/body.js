// One jelly: a shell of icosphere particles simulated with XPBD (Macklin et al.
// 2016, "XPBD: Position-Based Simulation of Compliant Constrained Dynamics";
// small-steps variant, one iteration per substep). Constraints:
//   - shape matching to a blobby rest shape (rotation extracted each substep,
//     Mueller et al. 2016 "A Robust Method to Extract the Rotational Part of
//     Deformations"), which carries the tumble and the wobble;
//   - edge distance between neighbouring particles.
// Contacts and the viewer's bubble are applied by the field (field.js).
// Each frame the shell is fitted to spherical harmonics (sh.js): that smooth
// radial function is what is drawn and what other jellies collide with.
import { icosphere, vertexSolidAngles } from './icosphere.js';
import { SH_COUNT, shFit, shRadius } from './sh.js';

const SHELL = icosphere(2);
export const PARTICLES = SHELL.vertices.length;
const WEIGHTS = vertexSolidAngles(SHELL.vertices, SHELL.triangles);
const EDGES = SHELL.edges;

export const BODY = Object.freeze({
  shapeHz: 1.1,          // wobble frequency of shape matching (Hz)
  edgeHz: 2.6,           // stiffness of the shell's edges (Hz)
  damping: 0.35,         // per second, velocity decay
  blobWaves: 3,          // low-frequency waves that make the rest shape blobby
  blobAmplitude: 0.16,   // relative radius variation
  blobFrequency: 2.2,    // wave number on the unit sphere
  breathScale: 0.04,     // rest size breathes +-2% with the shared breath
  boundMargin: 1.08,
  rotationIterations: 3,
});

const TAU = Math.PI * 2;
const DENSITY = 1;
const VOLUME_FACTOR = (4 / 3) * Math.PI;
const SHELL_INERTIA = 2 / 3; // sum r x (w x r) = (2/3) sum |r|^2 w for a near-uniform shell

export const volumeOf = (r) => VOLUME_FACTOR * r * r * r;
export const radiusOfVolume = (v) => Math.cbrt(v / VOLUME_FACTOR);

/** Deterministic PRNG (mulberry32), so tests and sessions are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Blobby rest radii on the shell's directions, scaled to the volume of a sphere of `radius`. */
function blobRestShape(radius, random) {
  const waves = Array.from({ length: BODY.blobWaves }, () => {
    const u = random() * 2 - 1, phi = random() * TAU, s = Math.sqrt(1 - u * u);
    return { k: [s * Math.cos(phi), s * Math.sin(phi), u].map((x) => x * BODY.blobFrequency), phase: random() * TAU };
  });
  const radii = SHELL.vertices.map((d) => {
    let n = 0;
    for (const w of waves) n += Math.sin(d[0] * w.k[0] + d[1] * w.k[1] + d[2] * w.k[2] + w.phase);
    return 1 + (BODY.blobAmplitude * n) / Math.sqrt(BODY.blobWaves);
  });
  // Volume of a star-shaped body: (1/3) sum w_i r_i^3. Scale to the target.
  let v = 0;
  for (let i = 0; i < PARTICLES; i++) v += (WEIGHTS[i] * radii[i] ** 3) / 3;
  const scale = radius * Math.cbrt(VOLUME_FACTOR / v);
  const rest = new Float64Array(PARTICLES * 3);
  SHELL.vertices.forEach((d, i) => {
    for (let k = 0; k < 3; k++) rest[i * 3 + k] = d[k] * radii[i] * scale;
  });
  // Centre it: shape matching assumes a zero-mean rest shape, otherwise the
  // goal positions carry a net offset and the body drifts.
  for (let k = 0; k < 3; k++) {
    let m = 0;
    for (let i = 0; i < PARTICLES; i++) m += rest[i * 3 + k];
    m /= PARTICLES;
    for (let i = 0; i < PARTICLES; i++) rest[i * 3 + k] -= m;
  }
  return rest;
}

// ── small 3x3 / quaternion helpers (column-major mat3 in Float64Array(9)) ──
function quatToMat(q, m) {
  const [x, y, z, w] = q;
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + z * w); m[2] = 2 * (x * z - y * w);
  m[3] = 2 * (x * y - z * w); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z + x * w);
  m[6] = 2 * (x * z + y * w); m[7] = 2 * (y * z - x * w); m[8] = 1 - 2 * (x * x + y * y);
  return m;
}

function quatMul(a, b, out) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

const tmpR = new Float64Array(9);
const tmpQ = [0, 0, 0, 1];
const tmpQ2 = [0, 0, 0, 1];

/** Rotation part of A (column-major) by iterative quaternion refinement, warm-started from q. */
function extractRotation(A, q, iterations) {
  for (let it = 0; it < iterations; it++) {
    quatToMat(q, tmpR);
    let ox = 0, oy = 0, oz = 0, dot = 0;
    for (let c = 0; c < 3; c++) {
      const rx = tmpR[c * 3], ry = tmpR[c * 3 + 1], rz = tmpR[c * 3 + 2];
      const ax = A[c * 3], ay = A[c * 3 + 1], az = A[c * 3 + 2];
      ox += ry * az - rz * ay; oy += rz * ax - rx * az; oz += rx * ay - ry * ax;
      dot += rx * ax + ry * ay + rz * az;
    }
    const s = 1 / (Math.abs(dot) + 1e-9);
    ox *= s; oy *= s; oz *= s;
    const w = Math.hypot(ox, oy, oz);
    if (w < 1e-9) break;
    const half = w / 2, sh = Math.sin(half) / w;
    tmpQ[0] = ox * sh; tmpQ[1] = oy * sh; tmpQ[2] = oz * sh; tmpQ[3] = Math.cos(half);
    quatMul(tmpQ, q, tmpQ2);
    const l = Math.hypot(...tmpQ2);
    for (let k = 0; k < 4; k++) q[k] = tmpQ2[k] / l;
  }
  return q;
}

let nextId = 1;

export class JellyBody {
  /**
   * @param {object} o center, velocity, spin (angular velocity vector), radius,
   *   look, color, color2, random, initialPositions (optional Float64Array 3N)
   */
  constructor(o) {
    this.id = nextId++;
    this.radius = o.radius;
    this.mass = DENSITY * volumeOf(o.radius);
    this.particleMass = this.mass / PARTICLES;
    this.look = o.look;
    this.color = o.color;
    this.color2 = o.color2;
    this.seed = o.random();
    this.rest = blobRestShape(o.radius, o.random);
    this.edgeRest = Float64Array.from(EDGES, ([i, j]) => {
      const r = this.rest;
      return Math.hypot(r[i * 3] - r[j * 3], r[i * 3 + 1] - r[j * 3 + 1], r[i * 3 + 2] - r[j * 3 + 2]);
    });
    this.x = new Float64Array(PARTICLES * 3);
    this.prev = new Float64Array(PARTICLES * 3);
    this.v = new Float64Array(PARTICLES * 3);
    this.q = [0, 0, 0, 1];
    this.rotation = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    this.center = new Float64Array(o.center);
    this.coeffs = new Float64Array(SH_COUNT);
    this.boundRadius = o.radius * BODY.boundMargin;
    this.merge = null;          // { other, s }
    this.contactTime = new Map();
    this.age = 0;
    this.dirs = new Float64Array(PARTICLES * 3);
    this.radii = new Float64Array(PARTICLES);
    this.A = new Float64Array(9);

    const [cx, cy, cz] = o.center, [vx, vy, vz] = o.velocity, [wx, wy, wz] = o.spin ?? [0, 0, 0];
    for (let i = 0; i < PARTICLES; i++) {
      const j = i * 3;
      const px = o.initialPositions ? o.initialPositions[j] - cx : this.rest[j];
      const py = o.initialPositions ? o.initialPositions[j + 1] - cy : this.rest[j + 1];
      const pz = o.initialPositions ? o.initialPositions[j + 2] - cz : this.rest[j + 2];
      this.x[j] = cx + px; this.x[j + 1] = cy + py; this.x[j + 2] = cz + pz;
      this.v[j] = vx + wy * pz - wz * py;
      this.v[j + 1] = vy + wz * px - wx * pz;
      this.v[j + 2] = vz + wx * py - wy * px;
    }
    this.refit();
  }

  /** Centroid, SH fit and bounds from the current particles. */
  refit() {
    const x = this.x, c = this.center;
    c[0] = c[1] = c[2] = 0;
    for (let i = 0; i < PARTICLES; i++) { c[0] += x[i * 3]; c[1] += x[i * 3 + 1]; c[2] += x[i * 3 + 2]; }
    c[0] /= PARTICLES; c[1] /= PARTICLES; c[2] /= PARTICLES;
    let maxR = 0;
    for (let i = 0; i < PARTICLES; i++) {
      const dx = x[i * 3] - c[0], dy = x[i * 3 + 1] - c[1], dz = x[i * 3 + 2] - c[2];
      const r = Math.hypot(dx, dy, dz) || 1e-6;
      this.radii[i] = r;
      this.dirs[i * 3] = dx / r; this.dirs[i * 3 + 1] = dy / r; this.dirs[i * 3 + 2] = dz / r;
      if (r > maxR) maxR = r;
    }
    shFit(this.dirs, this.radii, WEIGHTS, this.coeffs);
    this.boundRadius = maxR * BODY.boundMargin;
  }

  /** Surface radius along a world-space offset from the centre. */
  surfaceRadius(dx, dy, dz) {
    return shRadius(this.coeffs, dx, dy, dz);
  }

  momentum(out = [0, 0, 0]) {
    out[0] = out[1] = out[2] = 0;
    for (let i = 0; i < PARTICLES; i++) { out[0] += this.v[i * 3]; out[1] += this.v[i * 3 + 1]; out[2] += this.v[i * 3 + 2]; }
    for (let k = 0; k < 3; k++) out[k] *= this.particleMass;
    return out;
  }

  velocity(out = [0, 0, 0]) {
    this.momentum(out);
    for (let k = 0; k < 3; k++) out[k] /= this.mass;
    return out;
  }

  /** Add a uniform velocity change to every particle. */
  kick(dvx, dvy, dvz) {
    for (let i = 0; i < PARTICLES; i++) { this.v[i * 3] += dvx; this.v[i * 3 + 1] += dvy; this.v[i * 3 + 2] += dvz; }
  }

  /** Damp only the wobble: velocity relative to the body's rigid translation and
   *  rotation. Damping everything would stop the drift and tumble. */
  dampWobble(h) {
    const x = this.x, v = this.v, c = this.center;
    let vx = 0, vy = 0, vz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < PARTICLES; i++) {
      vx += v[i * 3]; vy += v[i * 3 + 1]; vz += v[i * 3 + 2];
      cx += x[i * 3]; cy += x[i * 3 + 1]; cz += x[i * 3 + 2];
    }
    vx /= PARTICLES; vy /= PARTICLES; vz /= PARTICLES;
    cx /= PARTICLES; cy /= PARTICLES; cz /= PARTICLES;
    // Angular velocity of a near-spherical shell: w = sum r x v / ((2/3) sum |r|^2).
    let lx = 0, ly = 0, lz = 0, rr = 0;
    for (let i = 0; i < PARTICLES; i++) {
      const rx = x[i * 3] - cx, ry = x[i * 3 + 1] - cy, rz = x[i * 3 + 2] - cz;
      const ux = v[i * 3] - vx, uy = v[i * 3 + 1] - vy, uz = v[i * 3 + 2] - vz;
      lx += ry * uz - rz * uy; ly += rz * ux - rx * uz; lz += rx * uy - ry * ux;
      rr += rx * rx + ry * ry + rz * rz;
    }
    const inv = 1 / (SHELL_INERTIA * rr + 1e-12);
    const wx = lx * inv, wy = ly * inv, wz = lz * inv;
    const decay = Math.exp(-BODY.damping * h);
    for (let i = 0; i < PARTICLES; i++) {
      const rx = x[i * 3] - cx, ry = x[i * 3 + 1] - cy, rz = x[i * 3 + 2] - cz;
      const gx = vx + wy * rz - wz * ry, gy = vy + wz * rx - wx * rz, gz = vz + wx * ry - wy * rx;
      v[i * 3] = gx + (v[i * 3] - gx) * decay;
      v[i * 3 + 1] = gy + (v[i * 3 + 1] - gy) * decay;
      v[i * 3 + 2] = gz + (v[i * 3 + 2] - gz) * decay;
    }
  }

  predict(h) {
    this.dampWobble(h);
    for (let j = 0; j < PARTICLES * 3; j++) {
      this.prev[j] = this.x[j];
      this.x[j] += this.v[j] * h;
    }
  }

  /** Shape matching + edges, one XPBD iteration. Stiffness given as a frequency,
   *  so it is independent of size and mass: alpha~ = 1 / (omega h)^2. */
  solveInternal(h, breath) {
    const x = this.x, rest = this.rest, A = this.A;
    // centroid
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < PARTICLES; i++) { cx += x[i * 3]; cy += x[i * 3 + 1]; cz += x[i * 3 + 2]; }
    cx /= PARTICLES; cy /= PARTICLES; cz /= PARTICLES;
    // A = sum (x_i - c) rest_i^T (column c = sum p * rest[c])
    A.fill(0);
    for (let i = 0; i < PARTICLES; i++) {
      const px = x[i * 3] - cx, py = x[i * 3 + 1] - cy, pz = x[i * 3 + 2] - cz;
      for (let c = 0; c < 3; c++) {
        const r = rest[i * 3 + c];
        A[c * 3] += px * r; A[c * 3 + 1] += py * r; A[c * 3 + 2] += pz * r;
      }
    }
    extractRotation(A, this.q, BODY.rotationIterations);
    const R = quatToMat(this.q, this.rotation);
    const scale = 1 + BODY.breathScale * (breath - 0.5);
    const aShape = 1 / ((TAU * BODY.shapeHz * h) ** 2);
    const fShape = 1 / (1 + aShape);
    for (let i = 0; i < PARTICLES; i++) {
      const rx = rest[i * 3] * scale, ry = rest[i * 3 + 1] * scale, rz = rest[i * 3 + 2] * scale;
      const gx = cx + R[0] * rx + R[3] * ry + R[6] * rz;
      const gy = cy + R[1] * rx + R[4] * ry + R[7] * rz;
      const gz = cz + R[2] * rx + R[5] * ry + R[8] * rz;
      x[i * 3] += (gx - x[i * 3]) * fShape;
      x[i * 3 + 1] += (gy - x[i * 3 + 1]) * fShape;
      x[i * 3 + 2] += (gz - x[i * 3 + 2]) * fShape;
    }
    const aEdge = 1 / ((TAU * BODY.edgeHz * h) ** 2);
    for (let e = 0; e < EDGES.length; e++) {
      const [i, j] = EDGES[e];
      const dx = x[j * 3] - x[i * 3], dy = x[j * 3 + 1] - x[i * 3 + 1], dz = x[j * 3 + 2] - x[i * 3 + 2];
      const len = Math.hypot(dx, dy, dz) || 1e-9;
      const C = len - this.edgeRest[e] * scale;
      const corr = C / (2 + aEdge) / len; // equal masses: each moves half of w/(sum w + alpha~)
      x[i * 3] += dx * corr; x[i * 3 + 1] += dy * corr; x[i * 3 + 2] += dz * corr;
      x[j * 3] -= dx * corr; x[j * 3 + 1] -= dy * corr; x[j * 3 + 2] -= dz * corr;
    }
  }

  finish(h) {
    for (let j = 0; j < PARTICLES * 3; j++) this.v[j] = (this.x[j] - this.prev[j]) / h;
  }

  /** Shift current positions only (inside a substep, so it becomes velocity). */
  translateParticles(dx, dy, dz) {
    for (let i = 0; i < PARTICLES; i++) { this.x[i * 3] += dx; this.x[i * 3 + 1] += dy; this.x[i * 3 + 2] += dz; }
  }

  /** Replace the shell (e.g. the shape of a fused pair) with a uniform velocity. */
  setPositions(positions, velocity) {
    this.x.set(positions);
    this.prev.set(positions);
    for (let i = 0; i < PARTICLES; i++) {
      this.v[i * 3] = velocity[0]; this.v[i * 3 + 1] = velocity[1]; this.v[i * 3 + 2] = velocity[2];
    }
    this.refit();
  }

  /** Shift every particle (floating origin). */
  translate(dx, dy, dz) {
    for (let i = 0; i < PARTICLES; i++) {
      this.x[i * 3] += dx; this.x[i * 3 + 1] += dy; this.x[i * 3 + 2] += dz;
      this.prev[i * 3] += dx; this.prev[i * 3 + 1] += dy; this.prev[i * 3 + 2] += dz;
    }
    this.center[0] += dx; this.center[1] += dy; this.center[2] += dz;
  }
}

export { SHELL, WEIGHTS };

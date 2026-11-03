import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JellyBody, PARTICLES, rng, volumeOf } from '../web/src/jellies/body.js';
import { FIELD, JellyField } from '../web/src/jellies/field.js';

const DT = 1 / 60;
const FAR = [1e6, 1e6, 1e6]; // viewer far away: no bubble
const FWD = [0, 0, 1];

function body(center, velocity, radius, seed = 3) {
  return new JellyBody({ center, velocity, radius, random: rng(seed), look: 'classic', color: '#ff4d6d', color2: '#3a5bff' });
}
const shellVolume = (b) => {
  // star-shaped volume from the SH surface: integrate r^3/3 over many directions
  let v = 0; const N = 4000;
  for (let i = 0; i < N; i++) {
    const u = 1 - (2 * (i + 0.5)) / N, phi = i * Math.PI * (3 - Math.sqrt(5)), s = Math.sqrt(1 - u * u);
    const r = b.surfaceRadius(s * Math.cos(phi), s * Math.sin(phi), u);
    v += (r ** 3) / 3;
  }
  return (v * 4 * Math.PI) / N;
};

test('a resting jelly keeps its volume (within 5%) and does not drift or blow up', () => {
  const f = new JellyField(7, { manage: false });
  const b = body([0, 0, 0], [0, 0, 0], 2);
  f.bodies.push(b);
  const v0 = volumeOf(2);
  for (let i = 0; i < 600; i++) f.step(DT, FAR, FWD, 0.5);
  assert.ok(Math.abs(shellVolume(b) - v0) / v0 < 0.05, `volume ${shellVolume(b)} vs ${v0}`);
  assert.ok(Math.hypot(...b.center) < 0.01, `drifted to ${[...b.center]}`);
  assert.ok(b.x.every(Number.isFinite));
});

test('flying through a jelly: it parts around you, then springs back with overshoot', () => {
  const f = new JellyField(7, { manage: false });
  const R = 2.5;
  const b = body([0, 0, 0], [0, 0, 0], R);
  f.bodies.push(b);
  for (let i = 0; i < 120; i++) f.step(DT, FAR, FWD, 0.5);
  const rest = b.surfaceRadius(1, 0, 0);
  const SPEED = 2.5;
  const viewer = [0, 0, -R - 3];
  let closest = Infinity;
  while (viewer[2] < R + 3) {
    viewer[2] += SPEED * DT;
    f.step(DT, viewer, FWD, 0.5);
    for (let i = 0; i < PARTICLES; i++) {
      closest = Math.min(closest, Math.hypot(b.x[i * 3] - viewer[0], b.x[i * 3 + 1] - viewer[1], b.x[i * 3 + 2] - viewer[2]));
    }
  }
  assert.ok(closest > 0.5 * FIELD.bubbleRadius, `skin came within ${closest.toFixed(2)} of the viewer`);
  const shoved = Math.hypot(...b.center);
  assert.ok(shoved < 1.0, `jelly was bulldozed ${shoved.toFixed(2)} units instead of parting`);
  // Wobble of the face we flew through (its radius along the travel axis).
  let peak = -Infinity, trough = Infinity;
  for (let i = 0; i < 300; i++) {
    f.step(DT, FAR, FWD, 0.5);
    const r = b.surfaceRadius(0, 0, 1);
    peak = Math.max(peak, r); trough = Math.min(trough, r);
  }
  assert.ok(peak - trough > 0.05 * R, `no wobble after passing: range ${(peak - trough).toFixed(3)}`);
  assert.ok(Math.abs(b.surfaceRadius(1, 0, 0) - rest) < 0.25 * R, 'shape did not recover');
  assert.ok(b.x.every(Number.isFinite));
});

test('two jellies squash on contact, then merge into one with volume and momentum conserved', () => {
  const f = new JellyField(11, { manage: false });
  const a = body([-3, 0, 0], [0.8, 0, 0], 1.5, 5);
  const b = body([3, 0, 0], [-0.4, 0, 0], 1.0, 9);
  // (manage: false: no gravity or spawning; the bump alone must merge them)
  f.bodies.push(a, b);
  const vol = volumeOf(1.5) + volumeOf(1.0);
  const p0 = a.momentum()[0] + b.momentum()[0];
  let minGap = Infinity, sawSquash = false;
  for (let i = 0; i < 60 * 12 && f.bodies.length === 2; i++) {
    f.step(DT, FAR, FWD, 0.5);
    if (f.bodies.length === 2 && !a.merge) {
      const d = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1], a.center[2] - b.center[2]);
      minGap = Math.min(minGap, d);
      if (d < a.radius + b.radius - 0.05) sawSquash = true;
    }
  }
  assert.equal(f.bodies.length, 1, 'did not merge');
  assert.ok(sawSquash, 'never squashed before merging');
  assert.ok(minGap > 0.5 * (1.5 + 1.0), `interpenetrated before merging (centre gap ${minGap})`);
  const m = f.bodies[0];
  assert.ok(Math.abs(volumeOf(m.radius) - vol) / vol < 1e-9, 'volume not conserved');
  const p1 = m.momentum()[0];
  assert.ok(Math.abs(p1 - p0) < 0.15 * Math.abs(p0) + 0.05, `momentum ${p0} -> ${p1}`);
  assert.equal(m.look, 'classic');
  assert.equal(f.merges, 1);
});

test('the merged jelly wobbles (starts as the blended pair, relaxes to its own shape)', () => {
  const f = new JellyField(11, { manage: false });
  f.bodies.push(body([-2, 0, 0], [0, 0, 0], 1.2, 5), body([2, 0, 0], [0, 0, 0], 1.2, 9));
  const fused = f.fuse(f.bodies[0], f.bodies[1]);
  const elong0 = fused.surfaceRadius(1, 0, 0) / fused.surfaceRadius(0, 1, 0);
  for (let i = 0; i < 240; i++) f.step(DT, FAR, FWD, 0.5);
  const elong1 = fused.surfaceRadius(1, 0, 0) / fused.surfaceRadius(0, 1, 0);
  assert.ok(elong0 > 1.4, `fused shell should start elongated (pair shape): ${elong0}`);
  assert.ok(elong1 < elong0 * 0.8, `should relax towards its own shape: ${elong0} -> ${elong1}`);
});

test('population: 12-15 jellies at all times after warm-up, over 10 simulated minutes of flight', () => {
  const f = new JellyField(42);
  const pos = [0, 0, 0];
  f.populate(pos, FWD);
  const COARSE = FIELD.maxDt;
  const SPEED = 2.5;
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < 600; t += COARSE) {
    pos[2] += SPEED * COARSE;
    pos[0] = 20 * Math.sin(t * 0.01);
    f.step(COARSE, pos, FWD, 0.5);
    if (t > 10) { lo = Math.min(lo, f.bodies.length); hi = Math.max(hi, f.bodies.length); }
  }
  assert.ok(lo >= FIELD.countMin && hi <= FIELD.countMax, `count ranged ${lo}..${hi}`);
  assert.ok(f.merges > 0, 'no merges happened');
  for (const b of f.bodies) assert.ok(b.x.every(Number.isFinite), 'non-finite particle');
});

test('spawned radii span the 500% range and stay within it', () => {
  const f = new JellyField(5);
  const radii = Array.from({ length: 2000 }, () => f.randomRadius());
  const min = Math.min(...radii), max = Math.max(...radii);
  assert.ok(min >= FIELD.radiusMin && max <= FIELD.radiusMin * FIELD.sizeRatio);
  assert.ok(max / min > FIELD.sizeRatio * 0.9, `range only ${max / min}x`);
});

test('shell has 162 particles', () => assert.equal(PARTICLES, 162));

test('merged jellies are born fully visible (no fade-in); new ones start at age 0', async () => {
  const f = new JellyField(11, { manage: false });
  const a = body([-2, 0, 0], [0, 0, 0], 1.2, 5), b = body([2, 0, 0], [0, 0, 0], 1.2, 9);
  f.bodies.push(a, b);
  assert.equal(a.age, 0);
  const fused = f.fuse(a, b);
  assert.ok(fused.age >= FIELD.bornVisibleAge);
});

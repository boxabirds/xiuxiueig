import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Viewer, VIEWER } from '../web/src/viewer.js';
import { TAU, WORLD_PERIOD } from '../web/src/world.js';

const DT = 1 / 60;
const run = (v, seconds, fn) => {
  const out = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    fn?.(v, i);
    v.step(DT);
    out.push(v);
  }
  return v;
};

test('drifts forward with no input', () => {
  const v = new Viewer();
  const start = [...v.position];
  run(v, 10);
  const moved = Math.hypot(v.position[0] - start[0], v.position[2] - start[2]);
  assert.ok(moved > VIEWER.baseSpeed * 10 * 0.8, `moved only ${moved}`);
});

test('lean does not snap: one frame moves the turn rate only a little', () => {
  const v = new Viewer();
  v.setLean(1, 0);
  v.step(DT);
  assert.ok(v.turn.value < VIEWER.maxTurnRate * 0.05, `turn jumped to ${v.turn.value}`);
});

test('lean response overshoots slightly, then settles (a body, not a cursor)', () => {
  const v = new Viewer();
  const target = (1 - VIEWER.deadzone) / (1 - VIEWER.deadzone) * VIEWER.maxTurnRate;
  let peak = 0;
  run(v, 8, (vv) => {
    vv.setLean(1, 0);
    peak = Math.max(peak, vv.turn.value);
  });
  assert.ok(peak > target * 1.03, `no overshoot: peak ${peak} vs ${target}`);
  assert.ok(peak < target * 1.4, `overshoot too large: ${peak}`);
  assert.ok(Math.abs(v.turn.value - target) < target * 0.02, `did not settle: ${v.turn.value}`);
});

test('leaning right turns toward screen-right (+x when heading 0)', () => {
  const v = new Viewer();
  const x0 = v.position[0];
  run(v, 3, (vv) => vv.setLean(1, 0));
  assert.ok(v.heading > 0 && v.heading < Math.PI, `heading ${v.heading}`);
  assert.ok(v.position[0] > x0);
});

test('leaning harder goes faster', () => {
  const v = new Viewer();
  run(v, 6, (vv) => vv.setLean(0.9, 0.3));
  assert.ok(v.speed.value > VIEWER.baseSpeed + VIEWER.leanSpeed * 0.7);
});

test('when the pointer leaves, the lean decays and drift continues', () => {
  const v = new Viewer();
  run(v, 4, (vv) => vv.setLean(1, 1));
  v.setLean(0, 0, false);
  run(v, 12);
  assert.ok(v.leanMagnitude < 0.01, `lean ${v.leanMagnitude}`);
  assert.ok(v.speed.value > VIEWER.baseSpeed * 0.9);
});

test('altitude stays inside its limits under sustained climb and dive', () => {
  const v = new Viewer();
  run(v, 60, (vv) => vv.setLean(0, 1));
  assert.ok(v.position[1] <= VIEWER.maxAltitude);
  run(v, 60, (vv) => vv.setLean(0, -1));
  assert.ok(v.position[1] >= VIEWER.minAltitude);
});

test('a simulated week stays wrapped: no precision drift', () => {
  const v = new Viewer();
  const WEEK_S = 7 * 24 * 3600;
  const COARSE_DT = 0.05;
  for (let t = 0; t < WEEK_S; t += COARSE_DT * 200) {
    for (let k = 0; k < 200; k++) {
      v.setLean(Math.sin(t * 0.001), Math.cos(t * 0.0007), true);
      v.step(COARSE_DT);
    }
  }
  assert.ok(v.position[0] >= 0 && v.position[0] < WORLD_PERIOD);
  assert.ok(v.position[2] >= 0 && v.position[2] < WORLD_PERIOD);
  assert.ok(v.heading >= 0 && v.heading < TAU);
  assert.ok(Number.isFinite(v.speed.value) && Number.isFinite(v.pitch.value));
});

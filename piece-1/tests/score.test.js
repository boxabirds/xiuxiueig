import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Score, SCORE, SKY_PALETTES } from '../web/src/score.js';
import { Viewer } from '../web/src/viewer.js';
import { PARAM_NAMES } from '../web/src/audio/params.js';
import { BREATH_PERIOD_S, TAU, WOBBLE_HZ } from '../web/src/world.js';

const DT = 1 / 60;

function simulate(seconds, { lean = [0, 0], bands = { low: 0.4, high: 0.2 }, dt = DT } = {}) {
  const v = new Viewer();
  const s = new Score();
  s.enter();
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    v.setLean(lean[0], lean[1]);
    v.step(dt);
    s.setConvergence(0.2);
    s.update(dt, v, bands);
  }
  return { s, v };
}

// Any real ratio is within 1/(q*N) of some p/q with q <= N (Dirichlet), so the
// honest claim is "no *small* ratio": denominators up to 5, tolerance 0.5%.
test('wobble frequencies have no small integer ratio', () => {
  const MAX_INT = 5;
  const TOL = 0.005;
  for (let i = 0; i < WOBBLE_HZ.length; i++) {
    for (let j = i + 1; j < WOBBLE_HZ.length; j++) {
      const r = WOBBLE_HZ[j] / WOBBLE_HZ[i];
      for (let q = 1; q <= MAX_INT; q++) {
        const p = Math.round(r * q);
        assert.ok(Math.abs(r - p / q) > TOL, `${WOBBLE_HZ[j]}/${WOBBLE_HZ[i]} ≈ ${p}/${q}`);
      }
    }
  }
});

test('breath completes a full cycle in BREATH_PERIOD_S', () => {
  const { s } = simulate(BREATH_PERIOD_S / 2);
  assert.ok(s.breath > 0.99, `half period should be full inhale, got ${s.breath}`);
  const { s: s2 } = simulate(BREATH_PERIOD_S);
  assert.ok(s2.breath < 0.01, `full period should be exhale, got ${s2.breath}`);
});

test('fade rises from nothing over the fade-in time', () => {
  const { s } = simulate(1);
  assert.ok(s.fade > 0 && s.fade < 0.3);
  const { s: s2 } = simulate(SCORE.fadeInS + 0.1);
  assert.equal(s2.fade, 1);
});

test('audio params are in range and in PARAM_NAMES order', () => {
  const { s } = simulate(20, { lean: [0.8, 0.4] });
  const p = s.audioParams;
  assert.equal(p.length, PARAM_NAMES.length);
  PARAM_NAMES.forEach((name, i) => {
    const [lo, hi] = name.startsWith('wobble') ? [-1, 1] : [0, 1];
    assert.ok(p[i] >= lo && p[i] <= hi, `${name}=${p[i]}`);
  });
  assert.equal(p[PARAM_NAMES.indexOf('breath')], Math.fround(s.breath));
  assert.equal(p[PARAM_NAMES.indexOf('wobble1')], s.wobble[1]); // both float32
});

test('one knob, two senses: misregistration drives both IOR spread and audio', () => {
  const calm = simulate(10).s;
  const fast = simulate(10, { lean: [0.9, 0.2] }).s;
  assert.ok(fast.misreg > calm.misreg + 0.2, `${calm.misreg} -> ${fast.misreg}`);
  const spread = (s) => s.ior[2] - s.ior[0];
  assert.ok(spread(fast) > spread(calm));
  assert.equal(fast.audioParams[PARAM_NAMES.indexOf('misreg')], Math.fround(fast.misreg));
});

test('audio bands feed back into the picture', () => {
  const quiet = simulate(3, { bands: { low: 0, high: 0 } }).s;
  const loud = simulate(3, { bands: { low: 1, high: 1 } }).s;
  assert.ok(loud.glow > 0.9 && quiet.glow < 0.01);
  assert.ok(loud.sparkle > 0.9 && quiet.sparkle < 0.01);
});

test('mute fades master to zero and back', () => {
  const v = new Viewer();
  const s = new Score();
  s.enter();
  for (let i = 0; i < 600; i++) s.update(DT, v, null);
  s.toggleMute();
  for (let i = 0; i < 300; i++) s.update(DT, v, null);
  assert.ok(s.audioParams[PARAM_NAMES.indexOf('master')] < 0.01);
  s.toggleMute();
  for (let i = 0; i < 300; i++) s.update(DT, v, null);
  assert.ok(s.audioParams[PARAM_NAMES.indexOf('master')] > 0.99);
});

test('a simulated week keeps every clock wrapped and finite', () => {
  const WEEK_S = 7 * 24 * 3600;
  const COARSE_DT = 0.25;
  const v = new Viewer();
  const s = new Score();
  s.enter();
  for (let t = 0; t < WEEK_S; t += COARSE_DT) {
    v.step(COARSE_DT);
    s.update(COARSE_DT, v, { low: 0.5, high: 0.5 });
  }
  for (const ph of [s.breathPhase, ...s.wobblePhase, ...s.warp, s.flavorPhase]) {
    assert.ok(ph >= 0 && ph < TAU, `phase ${ph}`);
  }
  assert.ok(s.skyPhase >= 0 && s.skyPhase < SKY_PALETTES.length);
  for (const x of s.audioParams) assert.ok(Number.isFinite(x));
  assert.ok(Number.isFinite(s.chaos) && Math.abs(s.chaos) <= 1);
});

test('the Benjolin warp clock never settles into a short loop', () => {
  const { s } = simulate(1);
  const samples = [];
  for (let i = 0; i < 6000; i++) {
    samples.push(s.benjolin.tick(DT).toFixed(4));
  }
  const distinct = new Set(samples).size;
  assert.ok(distinct > 1000, `only ${distinct} distinct chaos values`);
});

// ── Long-period evolution (owner feedback: "kinda samey after a few seconds") ──
function eraVector(s) {
  const e = s.era;
  return [...e.family, e.scale, e.turbulence, e.thickness, e.saturation, Math.cos(e.lightAzimuth), Math.sin(e.lightAzimuth)];
}

test('eras sweep their full range within an hour', () => {
  const v = new Viewer();
  const s = new Score();
  const lo = new Array(10).fill(Infinity);
  const hi = new Array(10).fill(-Infinity);
  for (let t = 0; t < 3600; t += 10) {
    s.advance(10, v, 1);
    eraVector(s).forEach((x, i) => { lo[i] = Math.min(lo[i], x); hi[i] = Math.max(hi[i], x); });
  }
  eraVector(s).forEach((_, i) => assert.ok(hi[i] - lo[i] > 0.8, `era component ${i} spans only ${lo[i]}..${hi[i]}`));
});

test('each surface family takes a clear turn as the dominant one', () => {
  const v = new Viewer();
  const s = new Score();
  const peak = [0, 0, 0];
  for (let t = 0; t < 3600; t += 10) {
    s.advance(10, v, 1);
    s.era.family.forEach((w, i) => { peak[i] = Math.max(peak[i], w); });
  }
  peak.forEach((w, i) => assert.ok(w > 0.75, `family ${i} never dominates (peak ${w})`));
});

test('the world does not return to an earlier state within an hour', () => {
  // Compare era states sampled every 30 s; any two at least 3 minutes apart must differ.
  const v = new Viewer();
  const s = new Score();
  const snaps = [];
  for (let t = 0; t < 3600; t += 30) {
    s.advance(30, v, 1);
    snaps.push(eraVector(s));
  }
  const MIN_GAP = 6; // samples = 3 minutes
  let closest = Infinity;
  for (let i = 0; i < snaps.length; i++) {
    for (let j = i + MIN_GAP; j < snaps.length; j++) {
      closest = Math.min(closest, Math.hypot(...snaps[i].map((x, k) => x - snaps[j][k])));
    }
  }
  assert.ok(closest > 0.25, `two states 3+ minutes apart are nearly identical (distance ${closest.toFixed(3)})`);
});

test('era signals reach the synth (one knob, two senses)', () => {
  const v = new Viewer();
  const s = new Score();
  s.advance(200, v, 1);
  assert.equal(s.audioParams[PARAM_NAMES.indexOf('eraRoot')], Math.fround(s.era.root));
  assert.equal(s.audioParams[PARAM_NAMES.indexOf('eraDensity')], Math.fround(s.era.thickness));
});

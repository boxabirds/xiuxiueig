import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP, VoiceSlots, gainFor, harmonicOf, pitchFor, plopPitchFor } from '../web/src/audio/mapping.js';
import { JellySound } from '../web/src/audio/sound.js';
import { PARAM_INDEX } from '../web/src/audio/params.js';
import { JellyBody, rng } from '../web/src/jellies/body.js';
import { JellyField } from '../web/src/jellies/field.js';
import { Viewer } from '../web/src/viewer.js';
import { Score } from '../web/src/score.js';

test('drone pitch falls with jelly size', () => {
  const seed = 0.4; // no variation offset
  assert.ok(pitchFor(0.8, seed) > pitchFor(2, seed));
  assert.ok(pitchFor(2, seed) > pitchFor(4, seed));
});

test('every drone pitch is a harmonic of the root (consonant)', () => {
  for (let i = 0; i < 500; i++) {
    const n = harmonicOf(pitchFor(0.5 + i * 0.02, (i * 0.618) % 1));
    assert.ok(Math.abs(n - Math.round(n)) < 1e-9 && n >= 1 && n <= MAP.maxHarmonic, `harmonic ${n}`);
  }
});

test('harmonic variation: same size, different seeds can differ by a neighbouring harmonic', () => {
  const pitches = new Set([0.05, 0.3, 0.6, 0.9].map((s) => pitchFor(1.5, s)));
  assert.ok(pitches.size >= 2);
});

test('gain falls with distance; bigger jellies are a little louder', () => {
  assert.ok(gainFor(0, 1) > gainFor(10, 1));
  assert.ok(gainFor(5, 3) > gainFor(5, 1));
});

test('bigger merges plop lower', () => assert.ok(plopPitchFor(1) > plopPitchFor(4)));

test('a fused jelly inherits the bigger parent slot (its pitch slides down)', () => {
  const s = new VoiceSlots(4);
  s.assign([10, 11, 12]);
  const parentSlot = s.slotOf.get(11);
  s.handover(11, 99);
  s.assign([10, 99]);
  assert.equal(s.slotOf.get(99), parentSlot);
  assert.ok(!s.slotOf.has(12));
});

test('end to end: a merge produces one plop, a squish while pressing, and a lower drone pitch', () => {
  const field = new JellyField(3, { manage: false });
  const mk = (c, v, r, seed) => new JellyBody({ center: c, velocity: v, radius: r, random: rng(seed), look: 'classic', color: '#ff4d6d', color2: '#3a5bff' });
  field.bodies.push(mk([-3, 0, 10], [0.9, 0, 0], 1.6, 1), mk([3, 0, 10], [-0.9, 0, 0], 1.2, 2));
  const viewer = new Viewer(); const score = new Score(); score.enter();
  const sound = new JellySound();
  sound.compute(field, viewer, score);
  const bigId = field.bodies[0].id;
  const slot = sound.slots.slotOf.get(bigId);
  const pitchBefore = sound.values[slot * 3];
  let maxSquish = 0;
  for (let i = 0; i < 60 * 8 && field.merges === 0; i++) {
    field.step(1 / 60, viewer.position, viewer.forward, 0.5);
    score.update(1 / 60);
    sound.compute(field, viewer, score);
    maxSquish = Math.max(maxSquish, sound.values[PARAM_INDEX.squish]);
  }
  assert.equal(field.merges, 1, 'no merge');
  assert.equal(sound.values[PARAM_INDEX.plopCount], 1);
  // Squish now follows rising pressure, so one bump peaks around 0.2 (it was
  // absolute pressure before, and saturated). 0.1 is still clearly audible.
  assert.ok(maxSquish > 0.1, `no squish while pressing: ${maxSquish}`);
  const fused = field.bodies[0];
  assert.equal(sound.slots.slotOf.get(fused.id), slot, 'fused jelly did not inherit the slot');
  assert.ok(sound.values[slot * 3] <= pitchBefore, `merged pitch ${sound.values[slot * 3]} should not be above ${pitchBefore}`);
});

test('jellies resting against each other are silent; a new bump squishes', () => {
  const field = new JellyField(4, { manage: false });
  const mk = (c, v, r, seed) => new JellyBody({ center: c, velocity: v, radius: r, random: rng(seed), look: 'classic', color: '#ff4d6d', color2: '#3a5bff' });
  // Pressed together and at rest (merging disabled to isolate resting contact).
  const a = mk([-1.15, 0, 10], [0, 0, 0], 1.2, 1), b = mk([1.15, 0, 10], [0, 0, 0], 1.2, 2);
  field.bodies.push(a, b);
  const merge = field.updateMerges; field.updateMerges = () => {};
  for (let i = 0; i < 180; i++) field.step(1 / 60, [0, 0, -50], [0, 0, 1], 0.5);
  let resting = 0;
  for (let i = 0; i < 120; i++) { field.step(1 / 60, [0, 0, -50], [0, 0, 1], 0.5); resting = Math.max(resting, field.squish.amount); }
  assert.ok(resting < 0.05, `resting contact squishes: ${resting}`);
  // A third jelly bumps in.
  field.bodies.push(mk([0, 4, 10], [0, -1.5, 0], 1.0, 3));
  let bump = 0;
  for (let i = 0; i < 180; i++) { field.step(1 / 60, [0, 0, -50], [0, 0, 1], 0.5); bump = Math.max(bump, field.squish.amount); }
  assert.ok(bump > 0.2, `a new bump should squish: ${bump}`);
  field.updateMerges = merge;
});

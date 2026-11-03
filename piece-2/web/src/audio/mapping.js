// From jellies to sound (owner: "smooth drone, pitch as a function of the size
// of the jelly (with some harmonic variation), squishes and water drop plops").
// Pure functions, unit tested in tests/mapping.test.js.
export const MAP = Object.freeze({
  root: 55,                 // Hz: every drone voice is a harmonic of this
  sizePitch: 352,           // Hz x radius: f_raw = sizePitch / radius (bigger = lower)
  maxHarmonic: 12,
  variation: [-1, 0, 0, 1], // seed picks a neighbouring harmonic: variety, still consonant
  attenuation: 7,           // world units: gain halves at this distance from the surface
  sizeWeightPower: 0.35,
  plopPitch: 1500,          // Hz x radius^plopPower
  plopPower: 0.6,
  squishPitch: 260,         // Hz x sqrt(radius): a low goo tone (~130 Hz big, ~290 Hz small)
  squishPower: 0.5,
});

/** Drone pitch for a jelly: inverse size, snapped to the root's harmonic series. */
export function pitchFor(radius, seed) {
  const raw = MAP.sizePitch / Math.max(radius, 1e-3);
  const n = Math.round(raw / MAP.root);
  const offset = MAP.variation[Math.floor(seed * MAP.variation.length) % MAP.variation.length];
  return MAP.root * Math.min(MAP.maxHarmonic, Math.max(1, n + offset));
}

export function harmonicOf(freq) { return freq / MAP.root; }

/** Raw voice gain from distance to the jelly's surface and its size. */
export function gainFor(distanceToSurface, radius) {
  const d = Math.max(0, distanceToSurface) / MAP.attenuation;
  return (1 / (1 + d * d)) * Math.pow(radius, MAP.sizeWeightPower);
}

export const plopPitchFor = (radius) => MAP.plopPitch / Math.pow(Math.max(radius, 0.1), MAP.plopPower);
export const squishPitchFor = (radius) => MAP.squishPitch / Math.pow(Math.max(radius, 0.1), MAP.squishPower);

/** Stable voice slots: each jelly keeps its slot; a fused jelly inherits the
 *  bigger parent's slot, so its pitch slides down from the parent's. */
export class VoiceSlots {
  constructor(count) {
    this.count = count;
    this.slotOf = new Map(); // jelly id -> slot
  }

  handover(fromId, toId) {
    if (this.slotOf.has(fromId)) { this.slotOf.set(toId, this.slotOf.get(fromId)); this.slotOf.delete(fromId); }
  }

  /** Assign slots to `ids` (ordered by priority); returns Map id -> slot. */
  assign(ids) {
    const keep = new Set(ids.slice(0, this.count));
    for (const id of [...this.slotOf.keys()]) if (!keep.has(id)) this.slotOf.delete(id);
    const used = new Set(this.slotOf.values());
    for (const id of keep) {
      if (this.slotOf.has(id)) continue;
      for (let s = 0; s < this.count; s++) if (!used.has(s)) { this.slotOf.set(id, s); used.add(s); break; }
    }
    return this.slotOf;
  }
}

// Main-thread side of piece 2's sound: AudioContext, worklet, AudioParams, and
// the per-frame mapping from the jelly field to voices, squish and plops.
import { MAP, VoiceSlots, gainFor, pitchFor, plopPitchFor, squishPitchFor } from './mapping.js';
import { PARAM_COUNT, PARAM_INDEX, PARAM_NAMES, VOICES } from './params.js';

const WASM_URL = new URL('../../assets/jelly.wasm', import.meta.url);
const WORKLET_URL = new URL('./worklet.js', import.meta.url);
const PLOP_MAX_DISTANCE = 30;

async function compileWasm() {
  const r = await fetch(WASM_URL);
  if (!r.ok) throw new Error(`failed to load ${WASM_URL}: ${r.status}`);
  try { return await WebAssembly.compileStreaming(r.clone()); } catch { return WebAssembly.compile(await r.arrayBuffer()); }
}

export class JellySound {
  constructor() {
    this.context = null;
    this.params = [];
    this.values = new Float32Array(PARAM_COUNT);
    this.slots = new VoiceSlots(VOICES);
    this.plopCount = 0;
    this.seenMerges = 0;
    for (let v = 0; v < VOICES; v++) this.values[v * 3] = MAP.root * 2;
  }

  async start() {
    this.context = new AudioContext({ latencyHint: 'playback' });
    const [module] = await Promise.all([compileWasm(), this.context.audioWorklet.addModule(WORKLET_URL)]);
    this.node = new AudioWorkletNode(this.context, 'jelly', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { module } });
    this.node.connect(this.context.destination);
    this.params = PARAM_NAMES.map((n) => this.node.parameters.get(n));
    if (this.context.state !== 'running') await this.context.resume();
    this.ready = true; // the context is 'running' before setup finishes: gate on this instead
  }

  get running() { return this.ready === true && this.context?.state === 'running'; }

  /** Compute every parameter from the field (also usable without audio, for tests). */
  compute(field, viewer, score) {
    const v = this.values, cam = viewer.position, basis = viewer.basis(new Float32Array(9));
    const right = [basis[0], basis[1], basis[2]];
    const panOf = (p) => {
      const dx = p[0] - cam[0], dy = p[1] - cam[1], dz = p[2] - cam[2], l = Math.hypot(dx, dy, dz) || 1;
      return (dx * right[0] + dy * right[1] + dz * right[2]) / l;
    };
    for (const f of field.fusions.splice(0)) this.slots.handover(f.from, f.to);
    const scored = field.bodies.map((b) => {
      const dist = Math.hypot(b.center[0] - cam[0], b.center[1] - cam[1], b.center[2] - cam[2]) - b.radius;
      return { b, g: gainFor(dist, b.radius) };
    }).sort((a, z) => z.g - a.g);
    const slotOf = this.slots.assign(scored.map((s) => s.b.id));
    const norm = 1 / Math.sqrt(Math.max(1, scored.reduce((s, x) => s + x.g * x.g, 0)));
    for (let s = 0; s < VOICES; s++) v[s * 3 + 1] = 0; // unassigned slots fade out (gain glides)
    for (const { b, g } of scored) {
      const s = slotOf.get(b.id);
      if (s === undefined) continue;
      v[s * 3] = pitchFor(b.radius, b.seed);
      v[s * 3 + 1] = g * norm;
      v[s * 3 + 2] = panOf(b.center);
    }
    const I = PARAM_INDEX;
    v[I.master] = score.master;
    v[I.breath] = score.breath;
    const sq = field.squish;
    v[I.squish] = sq.amount;
    v[I.squishPitch] = squishPitchFor(sq.radius);
    v[I.squishPan] = panOf(sq.position);
    if (field.merges > this.seenMerges) {
      const m = field.lastMerge;
      this.plopCount += field.merges - this.seenMerges;
      this.seenMerges = field.merges;
      const dist = Math.hypot(m.position[0] - cam[0], m.position[1] - cam[1], m.position[2] - cam[2]);
      v[I.plopPitch] = plopPitchFor(m.radius);
      v[I.plopPan] = panOf(m.position);
      v[I.plopGain] = Math.max(0, 1 - dist / PLOP_MAX_DISTANCE);
    }
    v[I.plopCount] = this.plopCount;
    return v;
  }

  update(_dt, field, viewer, score) {
    this.compute(field, viewer, score);
    if (!this.running) return;
    for (let i = 0; i < PARAM_COUNT; i++) this.params[i].value = this.values[i];
  }
}

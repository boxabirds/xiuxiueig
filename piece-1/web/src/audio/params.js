// Shared parameter block layout. Mirrors engine/crates/xiu-dsp/src/params.rs.
// Order matters: index i here is PARAMS[i] in WASM linear memory.
export const PARAM_NAMES = Object.freeze([
  'breath',      // 0..1
  'wobble0',     // -1..1
  'wobble1',     // -1..1
  'wobble2',     // -1..1
  'misreg',      // 0..1
  'agitation',   // 0..1
  'altitude',    // 0..1
  'spread',      // 0..1
  'convergence', // 0..1
  'master',      // 0..1
  'eraRoot',     // 0..1 minute-scale drone transposition
  'eraDensity',  // 0..1 thick-jelly era: darker filter
]);
export const PARAM_COUNT = PARAM_NAMES.length;
export const WOBBLE_NAMES = Object.freeze(['wobble0', 'wobble1', 'wobble2']);

export const PARAM_DESCRIPTORS = Object.freeze(
  PARAM_NAMES.map((name) => ({
    name,
    defaultValue: 0,
    minValue: WOBBLE_NAMES.includes(name) ? -1 : 0,
    maxValue: 1,
    automationRate: 'k-rate',
  })),
);

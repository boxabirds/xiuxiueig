// Parameter layout. Mirrors engine/crates/jelly-audio/src/params.rs.
export const VOICES = 16;
const voiceNames = Array.from({ length: VOICES }, (_, i) => [`f${i}`, `g${i}`, `p${i}`]).flat();
export const PARAM_NAMES = Object.freeze([
  ...voiceNames,
  'master', 'breath', 'squish', 'squishPitch', 'squishPan', 'plopCount', 'plopPitch', 'plopPan', 'plopGain',
]);
export const PARAM_COUNT = PARAM_NAMES.length; // 57
export const PARAM_INDEX = Object.freeze(Object.fromEntries(PARAM_NAMES.map((n, i) => [n, i])));
const RANGES = { f: [20, 4000], g: [0, 1], p: [-1, 1] };
const GLOBAL_RANGES = {
  master: [0, 1], breath: [0, 1], squish: [0, 1], squishPitch: [60, 1200], squishPan: [-1, 1],
  plopCount: [0, 1e9], plopPitch: [150, 3000], plopPan: [-1, 1], plopGain: [0, 1],
};
export const PARAM_DESCRIPTORS = Object.freeze(PARAM_NAMES.map((name) => {
  const [minValue, maxValue] = GLOBAL_RANGES[name] ?? RANGES[name[0]];
  return { name, defaultValue: minValue === 20 ? 110 : Math.max(0, minValue), minValue, maxValue, automationRate: 'k-rate' };
}));

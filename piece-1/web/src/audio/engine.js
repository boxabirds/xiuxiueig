// Main-thread side of the audio engine: context, worklet node, AudioParams,
// and the analyser that feeds sound back into the picture.
import { PARAM_NAMES } from './params.js';

const WASM_URL = new URL('../../assets/xiu.wasm', import.meta.url);
const WORKLET_URL = new URL('./worklet.js', import.meta.url);
const FFT_SIZE = 2048;
const ANALYSER_SMOOTHING = 0.8;
const LOW_BAND_HZ = [40, 220];
const HIGH_BAND_HZ = [1500, 6000];
// Calibrated against measured output (p5..p95 over 15 s): low -48..-37 dB,
// high -135..-100 dB before the glint boost.
const LOW_DB_RANGE = [-52, -34];
const HIGH_DB_RANGE = [-125, -85];

async function compileWasm() {
  const response = await fetch(WASM_URL);
  if (!response.ok) throw new Error(`failed to load ${WASM_URL}: ${response.status}`);
  try {
    return await WebAssembly.compileStreaming(response.clone());
  } catch {
    return WebAssembly.compile(await response.arrayBuffer());
  }
}

export class AudioEngine {
  constructor() {
    this.context = null;
    this.node = null;
    this.analyser = null;
    this.params = [];
    this.spectrum = null;
    this.bands = { low: 0, high: 0 };
    this.lowBins = [0, 0];
    this.highBins = [0, 0];
  }

  /** Must be called from a user gesture. */
  async start() {
    this.context = new AudioContext({ latencyHint: 'playback' });
    const [module] = await Promise.all([compileWasm(), this.context.audioWorklet.addModule(WORKLET_URL)]);
    this.node = new AudioWorkletNode(this.context, 'xiu', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { module },
    });
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
    this.node.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    this.params = PARAM_NAMES.map((name) => this.node.parameters.get(name));
    this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
    const hzPerBin = this.context.sampleRate / FFT_SIZE;
    this.lowBins = LOW_BAND_HZ.map((hz) => Math.round(hz / hzPerBin));
    this.highBins = HIGH_BAND_HZ.map((hz) => Math.round(hz / hzPerBin));
    if (this.context.state !== 'running') await this.context.resume();
  }

  get running() {
    return this.context?.state === 'running';
  }

  /** Write the shared signals (Float32Array-like, PARAM_NAMES order). */
  setParams(values) {
    for (let i = 0; i < this.params.length; i++) this.params[i].value = values[i];
  }

  bandLevel(range, [dbFloor, dbCeil]) {
    let sum = 0;
    for (let b = range[0]; b < range[1]; b++) sum += this.spectrum[b];
    const db = sum / Math.max(1, range[1] - range[0]);
    return Math.min(1, Math.max(0, (db - dbFloor) / (dbCeil - dbFloor)));
  }

  /** Low/high band energies 0..1 (audio -> picture). No allocation. */
  readBands() {
    if (!this.analyser) return this.bands;
    this.analyser.getFloatFrequencyData(this.spectrum);
    this.bands.low = this.bandLevel(this.lowBins, LOW_DB_RANGE);
    this.bands.high = this.bandLevel(this.highBins, HIGH_DB_RANGE);
    return this.bands;
  }
}

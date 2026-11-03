// AudioWorkletProcessor around the raw xiu WASM engine.
// Zero-copy: Float32Array views into WASM linear memory, created once.
// process() creates no JS objects: it copies k-rate AudioParam values into
// the WASM param block, calls xiu_render(), and deinterleaves in place.
import { PARAM_COUNT, PARAM_DESCRIPTORS, PARAM_NAMES } from './params.js';

const BLOCK_FRAMES = 128;
const CHANNELS = 2;
const LEFT = 0;
const RIGHT = 1;

class XiuProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAM_DESCRIPTORS;
  }

  constructor(options) {
    super();
    const instance = new WebAssembly.Instance(options.processorOptions.module, {});
    this.wasm = instance.exports;
    this.wasm.xiu_init(sampleRate);
    if (this.wasm.xiu_param_count() !== PARAM_COUNT) {
      throw new Error(`param layout mismatch: wasm ${this.wasm.xiu_param_count()} vs js ${PARAM_COUNT}`);
    }
    this.bindViews();
  }

  bindViews() {
    this.memoryBuffer = this.wasm.memory.buffer;
    this.output = new Float32Array(this.memoryBuffer, this.wasm.xiu_output_ptr(), this.wasm.xiu_output_len());
    this.params = new Float32Array(this.memoryBuffer, this.wasm.xiu_param_ptr(), PARAM_COUNT);
  }

  process(_inputs, outputs, parameters) {
    // The engine never grows memory after init; rebind only if it somehow did.
    if (this.wasm.memory.buffer !== this.memoryBuffer) this.bindViews();
    const out = outputs[0];
    const left = out[LEFT];
    const right = out[RIGHT];
    if (left.length !== BLOCK_FRAMES) {
      left.fill(0);
      right.fill(0);
      return true;
    }
    for (let i = 0; i < PARAM_COUNT; i++) this.params[i] = parameters[PARAM_NAMES[i]][0];
    this.wasm.xiu_render();
    const buf = this.output;
    for (let f = 0; f < BLOCK_FRAMES; f++) {
      left[f] = buf[f * CHANNELS];
      right[f] = buf[f * CHANNELS + 1];
    }
    return true;
  }
}

registerProcessor('xiu', XiuProcessor);

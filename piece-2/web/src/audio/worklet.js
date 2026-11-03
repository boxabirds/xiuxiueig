// AudioWorkletProcessor around the raw jelly WASM engine. Zero-copy views into
// WASM memory, created once; process() creates no JS objects.
import { PARAM_COUNT, PARAM_DESCRIPTORS, PARAM_NAMES } from './params.js';

const BLOCK_FRAMES = 128;
const CHANNELS = 2;

class JellyProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return PARAM_DESCRIPTORS; }

  constructor(options) {
    super();
    this.wasm = new WebAssembly.Instance(options.processorOptions.module, {}).exports;
    this.wasm.jelly_init(sampleRate);
    if (this.wasm.jelly_param_count() !== PARAM_COUNT) throw new Error(`param layout mismatch: ${this.wasm.jelly_param_count()} vs ${PARAM_COUNT}`);
    this.bind();
  }

  bind() {
    this.buffer = this.wasm.memory.buffer;
    this.out = new Float32Array(this.buffer, this.wasm.jelly_output_ptr(), this.wasm.jelly_output_len());
    this.params = new Float32Array(this.buffer, this.wasm.jelly_param_ptr(), PARAM_COUNT);
  }

  process(_inputs, outputs, parameters) {
    if (this.wasm.memory.buffer !== this.buffer) this.bind();
    const left = outputs[0][0], right = outputs[0][1];
    if (left.length !== BLOCK_FRAMES) { left.fill(0); right.fill(0); return true; }
    for (let i = 0; i < PARAM_COUNT; i++) this.params[i] = parameters[PARAM_NAMES[i]][0];
    this.wasm.jelly_render();
    const b = this.out;
    for (let f = 0; f < BLOCK_FRAMES; f++) { left[f] = b[f * CHANNELS]; right[f] = b[f * CHANNELS + 1]; }
    return true;
  }
}

registerProcessor('jelly', JellyProcessor);

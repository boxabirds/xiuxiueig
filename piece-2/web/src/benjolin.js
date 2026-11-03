// Control-rate port of JP-8's Benjolin (crates/jp8-core/src/benjolin.rs):
// two cross-modulated oscillators clock an 8-bit shift register with XOR
// feedback, read by a 3-bit DAC. Deterministic, but it never quite repeats.
// The Score uses it as the warp clock, so the shape's chaos is the same
// kind of chaos the synth uses for its filters.
const DAC_SCALE = 1 / 7;
const SEED = 0b10110101;
const FEEDBACK_BIT = 5;
const DAC_BITS = [0, 3, 6];
const BYTE_MASK = 0xff;
const MOD_SCALE = 2;
const HALF = 0.5;

export class Benjolin {
  constructor({ rate1, rate2, depth, slewPerSecond }) {
    this.rate1 = rate1;
    this.rate2 = rate2;
    this.depth = depth;
    this.slewPerSecond = slewPerSecond;
    this.phase1 = 0;
    this.phase2 = 0;
    this.register = SEED;
    this.dac = 0;
    this.output = 0;
  }

  tick(dt) {
    const mod = this.dac * this.depth;
    this.phase1 += this.rate1 * (1 + mod * MOD_SCALE) * dt;
    this.phase2 += this.rate2 * (1 + mod * MOD_SCALE) * dt;
    while (this.phase2 >= 1) this.phase2 -= 1;
    while (this.phase1 >= 1) {
      this.phase1 -= 1;
      const input = this.phase2 < HALF ? 1 : 0;
      const feedback = (this.register >> FEEDBACK_BIT) & 1;
      this.register = ((this.register << 1) | (input ^ feedback)) & BYTE_MASK;
      let raw = 0;
      for (let i = 0; i < DAC_BITS.length; i++) raw |= ((this.register >> DAC_BITS[i]) & 1) << i;
      this.dac = raw * DAC_SCALE;
    }
    const target = this.dac * 2 - 1;
    const k = 1 - Math.exp(-this.slewPerSecond * dt);
    this.output += k * (target - this.output);
    return this.output;
  }
}

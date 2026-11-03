// Shared clocks for piece 2: breath (jelly rest size + drone swell), the fade-in
// and mute. Wrapped phases only, so a week-long session keeps its precision.
const TAU = Math.PI * 2;
export const SCORE = Object.freeze({ breathPeriodS: 13, fadeInS: 6, muteFadeS: 0.6 });

export class Score {
  constructor(config = SCORE) {
    this.c = config;
    this.breathPhase = 0;
    this.breath = 0;
    this.fade = 0;
    this.entered = false;
    this.muted = false;
    this.muteGain = 1;
  }
  enter() { this.entered = true; }
  toggleMute() { this.muted = !this.muted; }
  update(dt) {
    const c = this.c;
    if (this.entered) this.fade = Math.min(1, this.fade + dt / c.fadeInS);
    this.muteGain += (1 - Math.exp(-dt / c.muteFadeS)) * ((this.muted ? 0 : 1) - this.muteGain);
    this.breathPhase = (this.breathPhase + (TAU * dt) / c.breathPeriodS) % TAU;
    this.breath = 0.5 - 0.5 * Math.cos(this.breathPhase);
    return this;
  }
  get master() { return this.fade * this.muteGain; }
}

// The Score: one module computes the shared signals once per frame and
// writes them to the shader uniforms and the synth together (brief:
// "Coupling"). Every clock is a wrapped phase accumulator, so a tab left
// open for a week holds the same precision as on its first second.
import { Benjolin } from './benjolin.js';
import { PARAM_COUNT, PARAM_NAMES } from './audio/params.js';
import { BASE_IOR, BREATH_PERIOD_S, TAU, WOBBLE_HZ, wrap } from './world.js';

export const SCORE = Object.freeze({
  fadeInS: 6,
  muteFadeS: 0.6,
  misregBase: 0.12,
  misregSpeed: 0.7,
  misregChaos: 0.18,
  warpBaseRate: 0.05,       // rad/s of warp phase when calm
  warpAgitationRate: 0.16,  // extra rad/s at full agitation
  warpRates: [1.0, 0.73, 0.57],
  warpChaosDepth: 0.6,
  flavorRate: 0.021,
  skyRate: 0.012,           // palettes per second
  iorSpreadMin: 0.012,      // Jelly Baby uses dispersion .025 (≈ ±0.0125)
  iorSpreadRange: 0.075,
  spreadMin: 0.35,
  agitationSmoothS: 1.2,
  convergenceSmoothS: 0.8,
  bandSmoothS: 0.25,
  convergenceFloor: 0.02,  // measured raw p5 ~0.024
  convergenceSpan: 0.05,   // measured raw p95 ~0.061
  benjolin: { rate1: 0.23, rate2: 0.37, depth: 0.8, slewPerSecond: 0.9 },
  // Eras: minute-scale clocks with incommensurate periods (seconds), so the
  // world keeps changing character over an hour without returning.
  eraPeriodsS: {
    family: 419,     // gyroid <-> Schwarz D <-> Schwarz P
    scale: 337,      // cell size
    turbulence: 263, // warp amplitude
    thickness: 547,  // gossamer <-> gummy
    saturation: 211, // pale <-> deep colour
    light: 613,      // light azimuth (caustics wander)
    root: 701,       // drone transposition
    drift: 389,      // very large-scale warp
  },
  eraAgitation: 0.35, // turbulent eras agitate the synth even when you are still
});

/** A print-run series: [zenith, horizon, accent] in linear RGB. Saturated
 *  silkscreen inks, never pastel (owner feedback: "kinda boring beige"). */
export const SKY_PALETTES = Object.freeze([
  [[0.05, 0.08, 0.60], [0.90, 0.10, 0.45], [1.00, 0.75, 0.05]], // ultramarine / hot pink / cadmium
  [[0.02, 0.35, 0.15], [0.75, 0.95, 0.05], [0.90, 0.05, 0.60]], // acid green / lemon / magenta
  [[0.25, 0.26, 0.32], [0.60, 0.62, 0.70], [1.00, 0.20, 0.55]], // silver / pink
  [[0.00, 0.30, 0.40], [1.00, 0.35, 0.02], [0.10, 0.90, 0.90]], // teal / tangerine / turquoise
  [[0.22, 0.03, 0.45], [0.95, 0.85, 0.05], [0.05, 0.60, 1.00]], // violet / lemon / azure
  [[0.45, 0.00, 0.08], [0.20, 0.95, 0.60], [1.00, 0.50, 0.00]], // cherry / mint / orange
]);

const smoothK = (seconds, dt) => 1 - Math.exp(-dt / seconds);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smootherstep = (x) => x * x * (3 - 2 * x);
const FAMILY_SHARPNESS = 3;
const SCALE_HOLD = 0.25;
const smoothstep01 = (x) => smootherstep(clamp01(x));

export class Score {
  constructor(config = SCORE) {
    this.c = config;
    this.benjolin = new Benjolin(config.benjolin);
    this.breathPhase = 0;
    this.wobblePhase = [0, 0, 0];
    this.warp = new Float32Array(3);
    this.flavorPhase = 0;
    this.skyPhase = 0;
    this.fade = 0;          // visual + audio fade-in, 0..1
    this.entered = false;
    this.muted = false;
    this.muteGain = 1;
    this.convergenceRaw = 0;
    this.eraPhase = Object.fromEntries(Object.keys(config.eraPeriodsS).map((k, i) => [k, (i * 1.7) % TAU]));
    this.era = {
      family: new Float32Array(3), // blend weights G, D, P (sum 1)
      scale: 0, turbulence: 0, thickness: 0, saturation: 0, lightAzimuth: 0, root: 0, drift: 0,
    };

    // Shared signals (read by renderer and audio).
    this.breath = 0;
    this.wobble = new Float32Array(3);
    this.misreg = 0;
    this.agitation = 0;
    this.altitude = 0.5;
    this.spread = 0.5;
    this.convergence = 0;
    this.chaos = 0;
    this.glow = 0;
    this.sparkle = 0;
    this.flavorAngle = 0;
    this.ior = new Float32Array([BASE_IOR, BASE_IOR, BASE_IOR]);
    this.sky = [new Float32Array(3), new Float32Array(3), new Float32Array(3)];
    this.audioParams = new Float32Array(PARAM_COUNT);
    this.paramIndex = Object.fromEntries(PARAM_NAMES.map((n, i) => [n, i]));
  }

  enter() {
    this.entered = true;
  }

  toggleMute() {
    this.muted = !this.muted;
  }

  /** Latest measured caustic focus (0..1) from the GPU readback. */
  setConvergence(value) {
    this.convergenceRaw = clamp01((value - this.c.convergenceFloor) / this.c.convergenceSpan);
  }

  update(rawDt, viewer, bands) {
    const c = this.c;
    const dt = Math.max(0, rawDt);
    if (this.entered) this.fade = Math.min(1, this.fade + dt / c.fadeInS);
    this.muteGain += smoothK(c.muteFadeS, dt) * ((this.muted ? 0 : 1) - this.muteGain);

    this.breathPhase = wrap(this.breathPhase + (TAU * dt) / BREATH_PERIOD_S, TAU);
    this.breath = 0.5 - 0.5 * Math.cos(this.breathPhase);
    for (let k = 0; k < 3; k++) {
      this.wobblePhase[k] = wrap(this.wobblePhase[k] + TAU * WOBBLE_HZ[k] * dt, TAU);
      this.wobble[k] = Math.sin(this.wobblePhase[k]);
    }

    this.chaos = this.benjolin.tick(dt);
    this.updateEras(dt);
    const agitationTarget = Math.max(viewer.leanMagnitude, this.era.turbulence * c.eraAgitation);
    this.agitation += smoothK(c.agitationSmoothS, dt) * (agitationTarget - this.agitation);
    this.misreg = clamp01(c.misregBase + viewer.normalizedSpeed * c.misregSpeed + Math.abs(this.chaos) * c.misregChaos);
    this.altitude = viewer.altitude01;
    this.spread = c.spreadMin + (1 - c.spreadMin) * (0.5 + 0.5 * Math.sin(viewer.heading));
    this.convergence += smoothK(c.convergenceSmoothS, dt) * (this.convergenceRaw - this.convergence);
    if (bands) {
      const kb = smoothK(c.bandSmoothS, dt);
      this.glow += kb * (bands.low - this.glow);
      this.sparkle += kb * (bands.high - this.sparkle);
    }

    const warpRate = (c.warpBaseRate + c.warpAgitationRate * this.agitation) * (1 + this.chaos * c.warpChaosDepth);
    for (let k = 0; k < 3; k++) this.warp[k] = wrap(this.warp[k] + warpRate * c.warpRates[k] * dt, TAU);
    this.flavorPhase = wrap(this.flavorPhase + c.flavorRate * TAU * dt, TAU);
    this.flavorAngle = viewer.heading;

    const spread = c.iorSpreadMin + c.iorSpreadRange * this.misreg;
    this.ior[0] = BASE_IOR - spread;
    this.ior[1] = BASE_IOR;
    this.ior[2] = BASE_IOR + spread;

    this.skyPhase = wrap(this.skyPhase + c.skyRate * dt, SKY_PALETTES.length);
    const i0 = Math.floor(this.skyPhase);
    const i1 = (i0 + 1) % SKY_PALETTES.length;
    const t = smootherstep(this.skyPhase - i0);
    for (let s = 0; s < 3; s++) {
      for (let ch = 0; ch < 3; ch++) {
        this.sky[s][ch] = SKY_PALETTES[i0][s][ch] * (1 - t) + SKY_PALETTES[i1][s][ch] * t;
      }
    }

    const p = this.audioParams;
    const ix = this.paramIndex;
    p[ix.breath] = this.breath;
    p[ix.wobble0] = this.wobble[0];
    p[ix.wobble1] = this.wobble[1];
    p[ix.wobble2] = this.wobble[2];
    p[ix.misreg] = this.misreg;
    p[ix.agitation] = this.agitation;
    p[ix.altitude] = this.altitude;
    p[ix.spread] = this.spread;
    p[ix.convergence] = this.convergence;
    p[ix.master] = this.fade * this.muteGain;
    p[ix.eraRoot] = this.era.root;
    p[ix.eraDensity] = this.era.thickness;
    return this;
  }

  updateEras(dt) {
    const periods = this.c.eraPeriodsS;
    for (const k in periods) this.eraPhase[k] = wrap(this.eraPhase[k] + (TAU * dt) / periods[k], TAU);
    const ph = this.eraPhase;
    const e = this.era;
    // Family: three soft lobes 120 degrees apart; sharpened so each era has a
    // clear dominant family, with long morphs between.
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      const w = Math.pow(0.5 + 0.5 * Math.cos(ph.family - (i * TAU) / 3), FAMILY_SHARPNESS);
      e.family[i] = w;
      sum += w;
    }
    for (let i = 0; i < 3; i++) e.family[i] /= sum;
    // Hold at fine or coarse for a third of the cycle each; morph in between.
    // (Also keeps the double field evaluation to the morphs only.)
    e.scale = smoothstep01((0.5 - 0.5 * Math.cos(ph.scale) - SCALE_HOLD) / (1 - 2 * SCALE_HOLD));
    e.turbulence = 0.5 - 0.5 * Math.cos(ph.turbulence);
    e.thickness = 0.5 - 0.5 * Math.cos(ph.thickness);
    e.saturation = 0.5 - 0.5 * Math.cos(ph.saturation);
    e.lightAzimuth = ph.light;
    e.root = 0.5 - 0.5 * Math.cos(ph.root);
    e.drift = ph.drift;
  }

  /** Jump the score (and viewer) forward: tests and previews. Coarse steps. */
  advance(seconds, viewer, step = 0.5) {
    for (let t = 0; t < seconds; t += step) {
      viewer.step(step);
      this.update(step, viewer, null);
    }
    return this;
  }
}

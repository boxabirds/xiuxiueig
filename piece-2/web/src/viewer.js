// Drift + lean (piece 1, adapted for free flight in space): always drifting
// forward; the pointer leans heading, pitch and speed through damped springs.
// No floor, no altitude band; pitch limited so the horizon never flips.
const TAU = Math.PI * 2;
const wrap = (v, p) => ((v % p) + p) % p;

export const VIEWER = Object.freeze({
  baseSpeed: 1.1,
  leanSpeed: 3.2,
  maxTurnRate: 0.6,
  maxPitch: (70 * Math.PI) / 180,
  deadzone: 0.06,
  springOmega: 1.9,
  springZeta: 0.55,
  bank: 0.35,
  idleAfterS: 4,
  idleDecayPerS: 0.6,
  wanderTurnRate: 0.12,
  wanderHz: [0.031, 0.0517],
  maxDt: 0.05,
});

class Spring {
  constructor(value = 0) { this.value = value; this.velocity = 0; }
  step(target, dt, omega, zeta) {
    this.velocity += (omega * omega * (target - this.value) - 2 * zeta * omega * this.velocity) * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}

export class Viewer {
  constructor(config = VIEWER) {
    this.c = config;
    this.position = [0, 0, 0];
    this.heading = 0;
    this.turn = new Spring(0);
    this.pitch = new Spring(0);
    this.speed = new Spring(config.baseSpeed);
    this.leanX = 0; this.leanY = 0; this.leanTargetX = 0; this.leanTargetY = 0;
    this.idleTime = Infinity;
    this.wanderPhase = [0, 0];
    this.roll = 0;
    this.forward = [0, 0, 1];
  }

  setLean(x, y, active = true) {
    this.leanTargetX = Math.max(-1, Math.min(1, x));
    this.leanTargetY = Math.max(-1, Math.min(1, y));
    this.idleTime = active ? 0 : Math.max(this.idleTime, this.c.idleAfterS);
  }

  get leanMagnitude() { return Math.min(1, Math.hypot(this.leanX, this.leanY)); }
  get normalizedSpeed() { return Math.max(0, (this.speed.value - this.c.baseSpeed) / this.c.leanSpeed); }

  deadzoned(v) {
    const a = Math.abs(v);
    return a < this.c.deadzone ? 0 : (Math.sign(v) * (a - this.c.deadzone)) / (1 - this.c.deadzone);
  }

  step(rawDt) {
    const c = this.c, dt = Math.min(rawDt, c.maxDt);
    this.idleTime += dt;
    if (this.idleTime >= c.idleAfterS) {
      const decay = Math.exp(-c.idleDecayPerS * dt);
      this.leanX *= decay; this.leanY *= decay;
    } else {
      this.leanX = this.deadzoned(this.leanTargetX);
      this.leanY = this.deadzoned(this.leanTargetY);
    }
    for (let i = 0; i < 2; i++) this.wanderPhase[i] = wrap(this.wanderPhase[i] + TAU * c.wanderHz[i] * dt, TAU);
    const wander = c.wanderTurnRate * 0.5 * (Math.sin(this.wanderPhase[0]) + Math.sin(this.wanderPhase[1]));
    const turn = this.turn.step(this.leanX * c.maxTurnRate + wander * (1 - this.leanMagnitude), dt, c.springOmega, c.springZeta);
    const pitch = Math.max(-c.maxPitch, Math.min(c.maxPitch, this.pitch.step(this.leanY * c.maxPitch, dt, c.springOmega, c.springZeta)));
    const speed = Math.max(0, this.speed.step(c.baseSpeed + this.leanMagnitude * c.leanSpeed, dt, c.springOmega, c.springZeta));
    this.heading = wrap(this.heading + turn * dt, TAU);
    this.roll = -turn * c.bank;
    const cp = Math.cos(pitch);
    this.forward[0] = Math.sin(this.heading) * cp;
    this.forward[1] = Math.sin(pitch);
    this.forward[2] = Math.cos(this.heading) * cp;
    for (let k = 0; k < 3; k++) this.position[k] += this.forward[k] * speed * dt;
    return this;
  }

  /** Camera basis (right, up, forward) as column-major mat3 into `out`. */
  basis(out) {
    const cy = Math.cos(this.heading), sy = Math.sin(this.heading);
    const cp = Math.cos(this.pitch.value), sp = Math.sin(this.pitch.value);
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const fwd = [sy * cp, sp, cy * cp], right0 = [cy, 0, -sy], up0 = [-sy * sp, cp, -cy * sp];
    for (let i = 0; i < 3; i++) {
      out[i] = right0[i] * cr + up0[i] * sr;
      out[3 + i] = up0[i] * cr - right0[i] * sr;
      out[6 + i] = fwd[i];
    }
    return out;
  }

  /** Floating origin: shift so the camera sits near (0,0,0). */
  rebase(offset) { for (let k = 0; k < 3; k++) this.position[k] -= offset[k]; }
}

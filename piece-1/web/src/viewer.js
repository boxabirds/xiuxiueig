// Drift + lean (brief: "Viewer motion"). The pointer offset is a lean; the
// body follows it through damped springs (slight overshoot, never a snap).
// With no input the viewer keeps drifting and the heading wanders.
import { BAND_BOTTOM, BAND_TOP, TAU, WORLD_PERIOD, wrap } from './world.js';

export const VIEWER = Object.freeze({
  baseSpeed: 0.7,        // units/s with no lean
  leanSpeed: 2.6,        // extra units/s at full lean
  maxTurnRate: 0.55,     // rad/s at full horizontal lean
  maxPitch: 0.5,         // rad at full vertical lean
  deadzone: 0.06,
  springOmega: 1.9,      // rad/s natural frequency
  springZeta: 0.55,      // < 1: slight overshoot (the Kineticist's sway)
  bank: 0.35,            // roll per rad/s of turn
  idleAfterS: 4,
  idleDecayPerS: 0.6,
  wanderTurnRate: 0.12,
  wanderHz: [0.031, 0.0517],
  minAltitude: 1.3,
  maxAltitude: BAND_TOP - 1.0, // always inside the membranes, never above them
  altitudeSoftZone: 1.2,
  maxDt: 0.05,
  startAltitude: (BAND_BOTTOM + BAND_TOP) / 2,
});

class Spring {
  constructor(value = 0) {
    this.value = value;
    this.velocity = 0;
  }
  step(target, dt, omega, zeta) {
    const accel = omega * omega * (target - this.value) - 2 * zeta * omega * this.velocity;
    this.velocity += accel * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}

export class Viewer {
  constructor(config = VIEWER) {
    this.c = config;
    this.position = [WORLD_PERIOD * 0.37, config.startAltitude, WORLD_PERIOD * 0.61];
    this.heading = 0;   // yaw, wrapped [0, 2π)
    this.turn = new Spring(0);
    this.pitch = new Spring(0);
    this.speed = new Spring(config.baseSpeed);
    this.leanX = 0;
    this.leanY = 0;
    this.leanTargetX = 0;
    this.leanTargetY = 0;
    this.idleTime = Infinity;
    this.wanderPhase = [0, 0];
    this.roll = 0;
  }

  /** Lean in [-1,1]^2 (x right, y up). `active` false = pointer gone. */
  setLean(x, y, active = true) {
    this.leanTargetX = Math.max(-1, Math.min(1, x));
    this.leanTargetY = Math.max(-1, Math.min(1, y));
    this.idleTime = active ? 0 : Math.max(this.idleTime, this.c.idleAfterS);
  }

  get leanMagnitude() {
    return Math.min(1, Math.hypot(this.leanX, this.leanY));
  }

  get normalizedSpeed() {
    return Math.max(0, (this.speed.value - this.c.baseSpeed) / this.c.leanSpeed);
  }

  get altitude01() {
    return Math.max(0, Math.min(1, (this.position[1] - this.c.minAltitude) / (this.c.maxAltitude - this.c.minAltitude)));
  }

  deadzoned(v) {
    const a = Math.abs(v);
    if (a < this.c.deadzone) return 0;
    return Math.sign(v) * (a - this.c.deadzone) / (1 - this.c.deadzone);
  }

  step(rawDt) {
    const c = this.c;
    const dt = Math.min(rawDt, c.maxDt);
    this.idleTime += dt;
    const idle = this.idleTime >= c.idleAfterS;
    if (idle) {
      const decay = Math.exp(-c.idleDecayPerS * dt);
      this.leanX *= decay;
      this.leanY *= decay;
    } else {
      this.leanX = this.deadzoned(this.leanTargetX);
      this.leanY = this.deadzoned(this.leanTargetY);
    }

    for (let i = 0; i < this.wanderPhase.length; i++) {
      this.wanderPhase[i] = wrap(this.wanderPhase[i] + TAU * c.wanderHz[i] * dt, TAU);
    }
    const wander = c.wanderTurnRate * 0.5 * (Math.sin(this.wanderPhase[0]) + Math.sin(this.wanderPhase[1]));
    const idleWeight = 1 - this.leanMagnitude;

    const turnTarget = this.leanX * c.maxTurnRate + wander * idleWeight;
    let pitchTarget = this.leanY * c.maxPitch;
    // Soft altitude limits: lean back toward the band near the edges.
    const y = this.position[1];
    const lowPush = Math.max(0, 1 - (y - c.minAltitude) / c.altitudeSoftZone);
    const highPush = Math.max(0, 1 - (c.maxAltitude - y) / c.altitudeSoftZone);
    pitchTarget += (lowPush - highPush) * c.maxPitch;
    const speedTarget = c.baseSpeed + this.leanMagnitude * c.leanSpeed;

    const turn = this.turn.step(turnTarget, dt, c.springOmega, c.springZeta);
    const pitch = this.pitch.step(pitchTarget, dt, c.springOmega, c.springZeta);
    const speed = Math.max(0, this.speed.step(speedTarget, dt, c.springOmega, c.springZeta));

    this.heading = wrap(this.heading + turn * dt, TAU);
    this.roll = -turn * c.bank;
    const horizontal = Math.cos(pitch) * speed * dt;
    this.position[0] = wrap(this.position[0] + Math.sin(this.heading) * horizontal, WORLD_PERIOD);
    this.position[2] = wrap(this.position[2] + Math.cos(this.heading) * horizontal, WORLD_PERIOD);
    this.position[1] = Math.max(c.minAltitude, Math.min(c.maxAltitude, y + Math.sin(pitch) * speed * dt));
    return this;
  }

  /** Camera basis (right, up, forward) as a column-major mat3 into `out`. */
  basis(out) {
    const cy = Math.cos(this.heading), sy = Math.sin(this.heading);
    const cp = Math.cos(this.pitch.value), sp = Math.sin(this.pitch.value);
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const fwd = [sy * cp, sp, cy * cp];
    const right0 = [cy, 0, -sy];
    const up0 = [-sy * sp, cp, -cy * sp];
    for (let i = 0; i < 3; i++) {
      out[i] = right0[i] * cr + up0[i] * sr;
      out[3 + i] = up0[i] * cr - right0[i] * sr;
      out[6 + i] = fwd[i];
    }
    return out;
  }
}

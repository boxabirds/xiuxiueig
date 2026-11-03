// The asteroid field: keeps 12-15 jellies around the viewer, steps their XPBD
// shells, resolves contacts (squash), the viewer's bubble (dents), merging
// (squash -> blend -> one jelly, volume and momentum conserved), spawning ahead
// and recycling behind. See docs/design/brief.md, "Jellies".
import { BODY, JellyBody, PARTICLES, radiusOfVolume, rng, volumeOf } from './body.js';

export const FIELD = Object.freeze({
  countMin: 12,
  countMax: 15,
  radiusMin: 0.8,
  sizeRatio: 5,                 // owner: 500% size variation
  // "12-15 at once" means in view: jellies spawn ahead and are recycled once
  // behind you, so nearly all of them are in front.
  spawnDistance: [15, 22],
  spawnConeCos: Math.cos((22 * Math.PI) / 180),  // inside the 30 deg half-height of the view
  recycleDistance: 26,
  recycleBehindDistance: 4,     // beyond this and outside the view cone: recycle
  recycleBehindCos: Math.cos((52 * Math.PI) / 180), // just outside the visible field (~43 deg wide), so nothing visibly pops
  initialDistance: [6, 20],
  initialConeCos: Math.cos((28 * Math.PI) / 180),
  spawnGap: 1.5,
  spawnTries: 80,
  spawnSpeed: 0.35,             // drift speed, units/s
  spawnSpin: 0.25,              // rad/s
  spawnChancePerSecond: 0.25,   // above countMin, chance per second to add one (up to countMax)
  substeps: 4,
  maxDt: 1 / 30,
  contactGap: 0.02,
  contactStiffness: 0.6,
  squashSeconds: 0.25,          // cumulative contact time before a squash turns into a merge
  contactMemorySeconds: 2,      // contact time fades over this long once apart
  contactStick: 0.35,           // fraction of relative normal velocity absorbed per substep on contact (sticky, not bouncy)
  gravity: 0.02,                // gentle mutual attraction, so jellies find each other and merge while you watch
  gravityMaxAccel: 0.05,        // (0.06 / 0.15 gave 18 merges in 20 s: a barrage of plops)
  gravitySoftening: 2,
  mergeSeconds: 2.5,
  mergeSpring: 1.6,             // 1/s^2: centres drawn together while blending
  mergeCompleteFraction: 0.35,  // centres closer than this x (rA + rB): become one
  bubbleRadius: 1.3,
  bubbleStiffness: 0.5,
  unionSearchSteps: 14,
  bornVisibleAge: 1e3,          // seconds; well past the renderer's fade-in
  // Squish follows *rising* pressure (fast minus slow average): jellies resting
  // against each other are silent. Measured before: absolute pressure kept the
  // squish above 0.2 for 79% of flight, because gravity holds clusters together.
  squishSensitivity: 15,        // measured live: 60 left the squish above 0.2 for 35% of flight
  squishFastS: 0.05,
  squishSlowS: 0.6,
  mergeSquish: 0.02,            // squelch depth per frame while a pair melts together
  unionScanSteps: 48,
  unionFallback: 0.6,           // fused-shell radius (x final) along rays that miss both parents
});

export const LOOKS = Object.freeze(['classic', 'zebra', 'spotty', 'stripy', 'swirly', 'sprinkle', 'checked', 'two-tone', 'glitter', 'rainbow', 'galaxy', 'golden']);
// Unix Jelly's sweets.
export const PALETTE = Object.freeze(['#ff4d6d', '#62c934', '#3a5bff', '#ffc61a', '#ff8a2b', '#9b5cff']);

const len3 = (x, y, z) => Math.hypot(x, y, z);

export class JellyField {
  /** @param manage false disables spawning/recycling (unit tests of the physics). */
  constructor(seed = 1, { manage = true } = {}) {
    this.manage = manage;
    this.gravityOn = manage;
    this.random = rng(seed);
    this.bodies = [];
    this.merges = 0;          // completed merges (for the sound: plops)
    this.lastMergeAge = Infinity;
    this.lastMerge = null;    // { position, radius }
    this.fusions = [];        // { from: bigger parent id, to: fused id }, consumed by the sound
    this.squish = { amount: 0, position: [0, 0, 0], radius: 1 };
    this.squishAccum = 0;
    this.squishFast = 0;
    this.squishSlow = 0;
    this.squishPos = [0, 0, 0];
    this.squishRadius = 0;
    this.radiusMax = FIELD.radiusMin * FIELD.sizeRatio;
  }

  randomRadius() {
    // Log-uniform: small ones are as common per octave as big ones.
    const lo = Math.log(FIELD.radiusMin), hi = Math.log(this.radiusMax);
    return Math.exp(lo + (hi - lo) * this.random());
  }

  randomLook() {
    const r = this.random;
    const ci = Math.floor(r() * PALETTE.length);
    return {
      look: LOOKS[Math.floor(r() * LOOKS.length)],
      color: PALETTE[ci],
      color2: PALETTE[(ci + 3) % PALETTE.length],
    };
  }

  randomUnit() {
    const u = this.random() * 2 - 1, phi = this.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    return [s * Math.cos(phi), s * Math.sin(phi), u];
  }

  fits(center, radius) {
    return this.bodies.every((b) => len3(b.center[0] - center[0], b.center[1] - center[1], b.center[2] - center[2]) > b.radius + radius + FIELD.spawnGap);
  }

  spawn(viewerPos, forward, initial = false) {
    for (let tries = 0; tries < FIELD.spawnTries; tries++) {
      let dir = this.randomUnit();
      // Prefer the cone ahead; widen to the whole forward hemisphere if crowded.
      const coneCos = tries < FIELD.spawnTries / 2 ? FIELD.spawnConeCos : 0;
      // Within a cone ahead, so jellies emerge from the dark in front of you.
      const facing = dir[0] * forward[0] + dir[1] * forward[1] + dir[2] * forward[2];
      if (facing < (initial ? FIELD.initialConeCos : coneCos)) continue;
      const [d0, d1] = initial ? FIELD.initialDistance : FIELD.spawnDistance;
      const dist = d0 + (d1 - d0) * this.random();
      const radius = this.randomRadius();
      const center = [0, 1, 2].map((k) => viewerPos[k] + dir[k] * dist);
      if (!this.fits(center, radius)) continue;
      const velocity = this.randomUnit().map((x) => x * FIELD.spawnSpeed * this.random());
      const spin = this.randomUnit().map((x) => x * FIELD.spawnSpin * this.random());
      const body = new JellyBody({ center, velocity, spin, radius, random: this.random, ...this.randomLook() });
      this.bodies.push(body);
      return body;
    }
    return null;
  }

  populate(viewerPos, forward) {
    const target = Math.round((FIELD.countMin + FIELD.countMax) / 2);
    for (let i = 0; i < target * 3 && this.bodies.length < target; i++) this.spawn(viewerPos, forward, true);
  }

  /** Push particles of `a` out of `b`'s surface; equal and opposite on b. Returns true if touching. */
  contact(a, b) {
    let touching = false;
    let pushX = 0, pushY = 0, pushZ = 0;
    const x = a.x, cb = b.center;
    for (let i = 0; i < PARTICLES; i++) {
      const dx = x[i * 3] - cb[0], dy = x[i * 3 + 1] - cb[1], dz = x[i * 3 + 2] - cb[2];
      const d = len3(dx, dy, dz);
      if (d > b.boundRadius + FIELD.contactGap || d < 1e-6) continue;
      const pen = b.surfaceRadius(dx, dy, dz) + FIELD.contactGap - d;
      if (pen <= 0) continue;
      touching = true;
      this.noteSquish(pen, x[i * 3], x[i * 3 + 1], x[i * 3 + 2], Math.min(a.radius, b.radius));
      const s = (pen * FIELD.contactStiffness) / d;
      x[i * 3] += dx * s; x[i * 3 + 1] += dy * s; x[i * 3 + 2] += dz * s;
      pushX += dx * s; pushY += dy * s; pushZ += dz * s;
    }
    if (touching) {
      // Conserve momentum: b moves back by a's displaced mass over b's mass.
      const k = -a.particleMass / b.mass;
      b.translateParticles(pushX * k, pushY * k, pushZ * k);
      this.stick(a, b);
    }
    return touching;
  }

  /** Absorb part of the relative velocity along the line of centres (momentum
   *  conserving), so bumping jellies press together instead of bouncing apart. */
  stick(a, b) {
    const va = a.velocity(), vb = b.velocity();
    const nx = b.center[0] - a.center[0], ny = b.center[1] - a.center[1], nz = b.center[2] - a.center[2];
    const d = len3(nx, ny, nz) || 1e-6;
    const closing = ((va[0] - vb[0]) * nx + (va[1] - vb[1]) * ny + (va[2] - vb[2]) * nz) / d;
    const separating = -closing;
    if (separating <= 0) return; // only damp rebounds
    const mu = (a.mass * b.mass) / (a.mass + b.mass);
    const j = FIELD.contactStick * separating * mu;
    a.kick((nx / d) * j / a.mass, (ny / d) * j / a.mass, (nz / d) * j / a.mass);
    b.kick((-nx / d) * j / b.mass, (-ny / d) * j / b.mass, (-nz / d) * j / b.mass);
  }

  /** Gentle pairwise attraction (softened, capped), equal and opposite. */
  gravitate(dt) {
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      const a = this.bodies[i];
      for (let j = i + 1; j < n; j++) {
        const b = this.bodies[j];
        const dx = b.center[0] - a.center[0], dy = b.center[1] - a.center[1], dz = b.center[2] - a.center[2];
        const d2 = dx * dx + dy * dy + dz * dz + FIELD.gravitySoftening ** 2;
        const d = Math.sqrt(d2);
        const f = (FIELD.gravity * a.mass * b.mass) / d2;
        const aa = Math.min(f / a.mass, FIELD.gravityMaxAccel) * dt, ab = Math.min(f / b.mass, FIELD.gravityMaxAccel) * dt;
        a.kick((dx / d) * aa, (dy / d) * aa, (dz / d) * aa);
        b.kick((-dx / d) * ab, (-dy / d) * ab, (-dz / d) * ab);
      }
    }
  }

  /** The viewer's bubble parts the skin sideways (perpendicular to the direction
   *  of travel), like a curtain, so you pass through a jelly instead of
   *  bulldozing it: a shell has no inside to push through. Small jellies are
   *  nudged out of the way the same way. */
  bubble(body, viewerPos, forward) {
    const x = body.x, R = FIELD.bubbleRadius;
    const dc = len3(body.center[0] - viewerPos[0], body.center[1] - viewerPos[1], body.center[2] - viewerPos[2]);
    if (dc > body.boundRadius + R) return;
    const [fx, fy, fz] = forward;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < PARTICLES; i++) {
      const dx = x[i * 3] - viewerPos[0], dy = x[i * 3 + 1] - viewerPos[1], dz = x[i * 3 + 2] - viewerPos[2];
      const d = len3(dx, dy, dz);
      if (d >= R) continue;
      // Offset perpendicular to travel; on the axis, part away from the body's centre.
      const along = dx * fx + dy * fy + dz * fz;
      let px = dx - along * fx, py = dy - along * fy, pz = dz - along * fz;
      let pl = len3(px, py, pz);
      if (pl < 1e-4) {
        const cx = x[i * 3] - body.center[0], cy = x[i * 3 + 1] - body.center[1], cz = x[i * 3 + 2] - body.center[2];
        const ca = cx * fx + cy * fy + cz * fz;
        px = cx - ca * fx; py = cy - ca * fy; pz = cz - ca * fz; pl = len3(px, py, pz);
        if (pl < 1e-4) { px = fy; py = -fx; pz = 0; pl = len3(px, py, pz) || 1; }
      }
      // Move out to the bubble's cylinder radius at this depth.
      const need = Math.sqrt(Math.max(R * R - along * along, 0)) - pl;
      if (need <= 0) continue;
      this.noteSquish(need, x[i * 3], x[i * 3 + 1], x[i * 3 + 2], body.radius);
      const s = (need * FIELD.bubbleStiffness) / pl;
      x[i * 3] += px * s; x[i * 3 + 1] += py * s; x[i * 3 + 2] += pz * s;
      sx += px * s; sy += py * s; sz += pz * s;
    }
    // Jellies bigger than the bubble only deform (you pass through them);
    // smaller ones keep the push and are batted aside.
    if (body.radius > FIELD.bubbleRadius && (sx || sy || sz)) {
      body.translateParticles(-sx / PARTICLES, -sy / PARTICLES, -sz / PARTICLES);
    }
  }

  noteSquish(depth, x, y, z, radius) {
    this.squishAccum += depth;
    this.squishPos[0] += x * depth; this.squishPos[1] += y * depth; this.squishPos[2] += z * depth;
    this.squishRadius += radius * depth;
  }

  /** Squish intensity for the sound: how much skin is being pressed this frame. */
  updateSquish(dt) {
    const a = this.squishAccum, sq = this.squish;
    this.squishFast += (a - this.squishFast) * (1 - Math.exp(-dt / FIELD.squishFastS));
    this.squishSlow += (a - this.squishSlow) * (1 - Math.exp(-dt / FIELD.squishSlowS));
    sq.amount = 1 - Math.exp(-Math.max(0, this.squishFast - this.squishSlow) * FIELD.squishSensitivity);
    if (a > 0) {
      for (let k = 0; k < 3; k++) sq.position[k] = this.squishPos[k] / a;
      sq.radius = this.squishRadius / a;
    }
    this.squishAccum = 0; this.squishPos.fill(0); this.squishRadius = 0;
  }

  step(dt, viewerPos, forward, breath) {
    const clamped = Math.min(Math.max(dt, 0), FIELD.maxDt);
    const h = clamped / FIELD.substeps;
    const n = this.bodies.length;
    for (let s = 0; s < FIELD.substeps; s++) {
      for (const b of this.bodies) b.predict(h);
      for (const b of this.bodies) b.solveInternal(h, breath);
      for (let i = 0; i < n; i++) {
        const a = this.bodies[i];
        for (let j = i + 1; j < n; j++) {
          const b = this.bodies[j];
          if (a.merge?.other === b) continue;
          const dc = len3(a.center[0] - b.center[0], a.center[1] - b.center[1], a.center[2] - b.center[2]);
          if (dc > a.boundRadius + b.boundRadius) continue;
          const t1 = this.contact(a, b), t2 = this.contact(b, a);
          // Counted at double rate because the memory below drains at the same rate while touching.
          if ((t1 || t2) && s === 0) a.contactTime.set(b.id, (a.contactTime.get(b.id) ?? 0) + clamped * 2);
        }
      }
      for (const b of this.bodies) this.bubble(b, viewerPos, forward);
      for (const b of this.bodies) b.finish(h);
    }
    for (const b of this.bodies) {
      b.refit();
      b.age += clamped;
      for (const [id, t] of b.contactTime) {
        const left = t - clamped / FIELD.contactMemorySeconds * FIELD.squashSeconds;
        if (left <= 0) b.contactTime.delete(id); else b.contactTime.set(id, left);
      }
    }
    if (this.gravityOn) this.gravitate(clamped);
    this.updateMerges(clamped);
    this.updateSquish(clamped);
    this.lastMergeAge += clamped;
    if (this.manage) {
      this.recycle(viewerPos, forward);
      this.replenish(clamped, viewerPos, forward);
    }
  }

  updateMerges(dt) {
    // Start: squash long enough -> blend.
    for (const a of this.bodies) {
      if (a.merge) continue;
      for (const [id, t] of a.contactTime) {
        if (t < FIELD.squashSeconds) continue;
        const b = this.bodies.find((x) => x.id === id);
        if (!b || b.merge) continue;
        a.merge = { other: b, s: 0 };
        b.merge = { other: a, s: 0 };
        a.contactTime.delete(id);
        break;
      }
    }
    // Progress: draw centres together (equal and opposite), then fuse.
    const done = new Set();
    for (const a of this.bodies) {
      if (!a.merge || done.has(a)) continue;
      const b = a.merge.other;
      done.add(a); done.add(b);
      a.merge.s = Math.min(1, a.merge.s + dt / FIELD.mergeSeconds);
      b.merge.s = a.merge.s;
      const dx = b.center[0] - a.center[0], dy = b.center[1] - a.center[1], dz = b.center[2] - a.center[2];
      const d = len3(dx, dy, dz) || 1e-6;
      const impulse = FIELD.mergeSpring * d * dt * (a.mass * b.mass) / (a.mass + b.mass);
      a.kick((dx / d) * impulse / a.mass, (dy / d) * impulse / a.mass, (dz / d) * impulse / a.mass);
      b.kick((-dx / d) * impulse / b.mass, (-dy / d) * impulse / b.mass, (-dz / d) * impulse / b.mass);
      this.noteSquish(FIELD.mergeSquish * (1 - a.merge.s * 0.5), (a.center[0] + b.center[0]) / 2, (a.center[1] + b.center[1]) / 2, (a.center[2] + b.center[2]) / 2, Math.min(a.radius, b.radius));
      if (a.merge.s >= 1 || d < FIELD.mergeCompleteFraction * (a.radius + b.radius)) this.fuse(a, b);
    }
  }

  /** Farthest distance from `from` along unit `dir` that is still inside body b
   *  (0 if the ray never enters it). Scans inwards from beyond b, then bisects. */
  surfaceAlong(b, from, dir) {
    const reach = len3(b.center[0] - from[0], b.center[1] - from[1], b.center[2] - from[2]) + b.boundRadius;
    const inside = (t) => {
      const px = from[0] + dir[0] * t - b.center[0], py = from[1] + dir[1] * t - b.center[1], pz = from[2] + dir[2] * t - b.center[2];
      return len3(px, py, pz) < b.surfaceRadius(px, py, pz);
    };
    const step = reach / FIELD.unionScanSteps;
    for (let t = reach; t > 0; t -= step) {
      if (!inside(t)) continue;
      let lo = t, hi = Math.min(reach, t + step);
      for (let i = 0; i < FIELD.unionSearchSteps; i++) {
        const mid = (lo + hi) / 2;
        if (inside(mid)) lo = mid; else hi = mid;
      }
      return lo;
    }
    return 0;
  }

  fuse(a, b) {
    const big = a.radius >= b.radius ? a : b, small = big === a ? b : a;
    const mass = a.mass + b.mass;
    const center = [0, 1, 2].map((k) => (a.center[k] * a.mass + b.center[k] * b.mass) / mass);
    const pa = a.momentum(), pb = b.momentum();
    const velocity = [0, 1, 2].map((k) => (pa[k] + pb[k]) / mass);
    const radius = radiusOfVolume(volumeOf(a.radius) + volumeOf(b.radius));
    const fused = new JellyBody({
      center, velocity, radius, random: this.random,
      look: big.look, color: big.color, color2: small.color,
    });
    // Start the new shell in the shape of the blended pair: its relaxation
    // towards its own rest shape is the post-merge wobble.
    const init = new Float64Array(PARTICLES * 3);
    for (let i = 0; i < PARTICLES; i++) {
      const dir = [fused.rest[i * 3], fused.rest[i * 3 + 1], fused.rest[i * 3 + 2]];
      const l = len3(...dir);
      for (let k = 0; k < 3; k++) dir[k] /= l;
      const r = Math.max(this.surfaceAlong(a, center, dir), this.surfaceAlong(b, center, dir), radius * FIELD.unionFallback);
      for (let k = 0; k < 3; k++) init[i * 3 + k] = center[k] + dir[k] * r;
    }
    fused.setPositions(init, velocity);
    fused.age = FIELD.bornVisibleAge; // born from two visible jellies: no fade-in
    this.bodies = this.bodies.filter((x) => x !== a && x !== b);
    this.bodies.push(fused);
    this.merges++;
    this.lastMergeAge = 0;
    this.lastMerge = { position: [...center], radius };
    this.fusions.push({ from: big.id, to: fused.id });
    return fused;
  }

  recycle(viewerPos, forward) {
    const far = (b) => {
      const dx = b.center[0] - viewerPos[0], dy = b.center[1] - viewerPos[1], dz = b.center[2] - viewerPos[2];
      const d = len3(dx, dy, dz);
      if (d > FIELD.recycleDistance) return true;
      const facing = (dx * forward[0] + dy * forward[1] + dz * forward[2]) / (d || 1);
      return d > FIELD.recycleBehindDistance + b.boundRadius && facing < FIELD.recycleBehindCos;
    };
    const gone = new Set(this.bodies.filter(far));
    for (const b of [...gone]) if (b.merge) gone.add(b.merge.other);
    if (gone.size) this.bodies = this.bodies.filter((b) => !gone.has(b));
  }

  replenish(dt, viewerPos, forward) {
    let guard = 0;
    while (this.bodies.length < FIELD.countMin && guard++ < FIELD.countMax) {
      if (!this.spawn(viewerPos, forward)) break;
    }
    if (this.bodies.length < FIELD.countMax && this.random() < FIELD.spawnChancePerSecond * dt) this.spawn(viewerPos, forward);
  }

  rebase(offset) {
    for (const b of this.bodies) b.translate(-offset[0], -offset[1], -offset[2]);
  }

  totalVolume() {
    return this.bodies.reduce((s, b) => s + volumeOf(b.radius), 0);
  }
}

export { BODY };

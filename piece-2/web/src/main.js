// Boot, entry, input, frame loop, adaptive resolution (with hysteresis), and
// the floating origin.
import { Renderer } from './gl/renderer.js';
import { JellyField } from './jellies/field.js';
import { Score } from './score.js';
import { Viewer } from './viewer.js';
import { JellySound } from './audio/sound.js';

const MAX_DPR = 2;
const SCALE_MIN = 0.3, SCALE_MAX = 1.0, SCALE_START = 0.5, SCALE_DOWN = 0.9, SCALE_UP = 1.05;
const SLOW_FRAME_MS = 21, FAST_FRAME_MS = 17.5, FRAME_EMA = 0.08;
const SCALE_DOWN_COOLDOWN_MS = 700, SCALE_UP_COOLDOWN_MS = 2500, CEILING_MARGIN = 0.97, CEILING_HOLD_MS = 30000;
const CURSOR_IDLE_MS = 3000, MAX_FRAME_DT_S = 0.1, MS_PER_S = 1000;
const REBASE_DISTANCE = 400; // floating origin: keep coordinates small for float precision
const FIELD_SEED = (Date.now() & 0xffff) || 1;

const canvas = document.getElementById('world');
const enterButton = document.getElementById('enter');
const fault = document.getElementById('fault');
const viewer = new Viewer();
const score = new Score();
const field = new JellyField(FIELD_SEED);
const sound = new JellySound();
let renderer = null, frameEma = 1000 / 60, lastScaleChange = 0, scaleCeiling = SCALE_MAX, ceilingUntil = 0, lastTime = 0, cursorTimer = 0, time = 0;

function showFault(message) { fault.textContent = message; fault.hidden = false; console.error(message); }
function resize() { renderer?.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, MAX_DPR)); }
function lean(e) { viewer.setLean((e.clientX / window.innerWidth) * 2 - 1, 1 - (e.clientY / window.innerHeight) * 2, true); }
function wakeCursor() {
  document.body.classList.remove('idle');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add('idle'), CURSOR_IDLE_MS);
}

window.addEventListener('pointermove', (e) => { wakeCursor(); if (score.entered) lean(e); });
window.addEventListener('pointerdown', (e) => { if (score.entered) lean(e); });
const release = (e) => { if (e.pointerType !== 'mouse') viewer.setLean(0, 0, false); };
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
document.documentElement.addEventListener('pointerleave', () => viewer.setLean(0, 0, false));
window.addEventListener('blur', () => viewer.setLean(0, 0, false));
window.addEventListener('keydown', (e) => { if (e.key === 'm' || e.key === 'M') score.toggleMute(); });
window.addEventListener('resize', resize);

enterButton.addEventListener('click', async () => {
  enterButton.classList.add('gone');
  try { await sound.start(); } catch (err) { showFault(`Sound could not start (${err.message}). The flight continues in silence.`); }
  score.enter();
  wakeCursor();
});

function adaptResolution(now, dtMs) {
  frameEma += (dtMs - frameEma) * FRAME_EMA;
  const since = now - lastScaleChange, scale = renderer.renderScale;
  let next = scale;
  if (frameEma > SLOW_FRAME_MS && since >= SCALE_DOWN_COOLDOWN_MS) {
    next = Math.max(SCALE_MIN, scale * SCALE_DOWN); scaleCeiling = scale * CEILING_MARGIN; ceilingUntil = now + CEILING_HOLD_MS;
  } else if (frameEma < FAST_FRAME_MS && since >= SCALE_UP_COOLDOWN_MS) {
    next = Math.max(scale, Math.min(now < ceilingUntil ? scaleCeiling : SCALE_MAX, scale * SCALE_UP));
  }
  if (next !== scale) { renderer.setRenderScale(next); lastScaleChange = now; }
}

function frame(now) {
  const dtMs = lastTime ? now - lastTime : 1000 / 60;
  lastTime = now;
  const dt = Math.min(dtMs / MS_PER_S, MAX_FRAME_DT_S);
  time += dt;
  viewer.step(dt);
  score.update(dt);
  field.step(dt, viewer.position, viewer.forward, score.breath);
  if (Math.hypot(...viewer.position) > REBASE_DISTANCE) {
    const offset = [...viewer.position];
    viewer.rebase(offset); field.rebase(offset); renderer.rebase(offset);
  }
  sound.update(dt, field, viewer, score);
  renderer.render(field, viewer, score.fade, time);
  adaptResolution(now, dtMs);
  requestAnimationFrame(frame);
}

async function boot() {
  try { renderer = await Renderer.create(canvas); } catch (err) { showFault(`This piece needs WebGL2: ${err.message}`); return; }
  renderer.setRenderScale(SCALE_START);
  resize();
  field.populate(viewer.position, viewer.forward);
  window.__xiu = { score, viewer, field, renderer, sound };
  requestAnimationFrame(frame);
}

boot();

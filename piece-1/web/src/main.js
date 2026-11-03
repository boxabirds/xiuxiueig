// Boot, entry, input, frame loop, adaptive resolution.
import { AudioEngine } from './audio/engine.js';
import { Renderer } from './gl/renderer.js';
import { Score } from './score.js';
import { Viewer } from './viewer.js';

const MAX_DPR = 2;
const SCALE_MIN = 0.3;
const SCALE_MAX = 1.0;
const SCALE_START = 0.55;
const SCALE_DOWN = 0.9;
const SCALE_UP = 1.05;
const SLOW_FRAME_MS = 21;   // below ~48 fps: shed pixels
const FAST_FRAME_MS = 17.5; // comfortably at 60 fps: add pixels
const FRAME_EMA = 0.08;
// Hysteresis: drop fast when slow, then treat that level as a ceiling for a
// while and creep up slowly. Without it the scale sawtoothed every ~0.7 s and the
// image visibly pumped (measured: it changed between captures 0.25 s apart).
const SCALE_DOWN_COOLDOWN_MS = 700;
const SCALE_UP_COOLDOWN_MS = 2500;
const CEILING_MARGIN = 0.97;
const CEILING_HOLD_MS = 30000;
const CURSOR_IDLE_MS = 3000;
const MAX_FRAME_DT_S = 0.1;
const MS_PER_S = 1000;

const canvas = document.getElementById('world');
const enterButton = document.getElementById('enter');
const fault = document.getElementById('fault');

const viewer = new Viewer();
const score = new Score();
const audio = new AudioEngine();
let renderer = null;
let frameEma = 1000 / 60;
let lastScaleChange = 0;
let scaleCeiling = SCALE_MAX;
let ceilingUntil = 0;
let lastTime = 0;
let cursorTimer = 0;

function showFault(message) {
  fault.textContent = message;
  fault.hidden = false;
  console.error(message);
}

function resize() {
  if (!renderer) return;
  renderer.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, MAX_DPR));
}

function leanFromEvent(e) {
  const x = (e.clientX / window.innerWidth) * 2 - 1;
  const y = 1 - (e.clientY / window.innerHeight) * 2;
  viewer.setLean(x, y, true);
}

function wakeCursor() {
  document.body.classList.remove('idle');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add('idle'), CURSOR_IDLE_MS);
}

window.addEventListener('pointermove', (e) => {
  wakeCursor();
  if (score.entered) leanFromEvent(e);
});
window.addEventListener('pointerdown', (e) => {
  if (score.entered) leanFromEvent(e);
});
const release = (e) => {
  if (e.pointerType !== 'mouse') viewer.setLean(0, 0, false);
};
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
document.documentElement.addEventListener('pointerleave', () => viewer.setLean(0, 0, false));
window.addEventListener('blur', () => viewer.setLean(0, 0, false));
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') score.toggleMute();
});
window.addEventListener('resize', resize);

enterButton.addEventListener('click', async () => {
  enterButton.classList.add('gone');
  try {
    await audio.start();
  } catch (err) {
    showFault(`Sound could not start (${err.message}). The world continues in silence.`);
  }
  score.enter();
  wakeCursor();
});

function adaptResolution(now, dtMs) {
  frameEma += (dtMs - frameEma) * FRAME_EMA;
  const since = now - lastScaleChange;
  const scale = renderer.renderScale;
  let next = scale;
  if (frameEma > SLOW_FRAME_MS && since >= SCALE_DOWN_COOLDOWN_MS) {
    next = Math.max(SCALE_MIN, scale * SCALE_DOWN);
    scaleCeiling = scale * CEILING_MARGIN;
    ceilingUntil = now + CEILING_HOLD_MS;
  } else if (frameEma < FAST_FRAME_MS && since >= SCALE_UP_COOLDOWN_MS) {
    const ceiling = now < ceilingUntil ? scaleCeiling : SCALE_MAX;
    next = Math.min(ceiling, scale * SCALE_UP);
    if (next < scale) next = scale;
  }
  if (next !== renderer.renderScale) {
    renderer.setRenderScale(next);
    lastScaleChange = now;
  }
}

function frame(now) {
  const dtMs = lastTime ? now - lastTime : 1000 / 60;
  lastTime = now;
  const dt = Math.min(dtMs / MS_PER_S, MAX_FRAME_DT_S);
  viewer.step(dt);
  score.setConvergence(renderer.convergence);
  score.update(dt, viewer, audio.running ? audio.readBands() : null);
  if (audio.running) audio.setParams(score.audioParams);
  renderer.render(score, viewer);
  adaptResolution(now, dtMs);
  requestAnimationFrame(frame);
}

async function boot() {
  try {
    renderer = await Renderer.create(canvas);
  } catch (err) {
    showFault(`This piece needs WebGL2: ${err.message}`);
    return;
  }
  renderer.setRenderScale(SCALE_START);
  resize();
  // Debug/test hook: read-only view of live state.
  window.__xiu = { score, viewer, audio, renderer };
  requestAnimationFrame(frame);
}

boot();

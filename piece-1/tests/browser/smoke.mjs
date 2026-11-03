// Browser smoke test (real GPU via ANGLE/Metal on macOS).
// Usage: npm run dev (in another shell), then npm run test:browser
// Checks: no console errors, audio running after entry, canvas not blank,
// pointer lean steers the viewer, frame rate. Saves screenshots to OUT_DIR.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.XIU_URL ?? 'http://127.0.0.1:5179/';
const OUT_DIR = process.env.XIU_OUT ?? 'tests/browser/out';
const VIEWPORT = { width: 1280, height: 800 };
const FADE_WAIT_MS = 7000;
const LEAN_MS = 4000;
const FPS_SAMPLE_MS = 3000;
const MIN_FPS = 50;
const MIN_PIXEL_STDDEV = 8;
const MAX_SCALE_CHANGES_10S = 3;

mkdirSync(OUT_DIR, { recursive: true });
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };

const browser = await chromium.launch({
  channel: process.env.XIU_CHANNEL ?? 'chrome',
  headless: process.env.XIU_HEADLESS !== '0',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL);
await page.waitForFunction(() => window.__xiu?.renderer);
const gpu = await page.evaluate(() => {
  const gl = window.__xiu.renderer.gl;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});
console.log(`GPU: ${gpu}`);
await page.screenshot({ path: `${OUT_DIR}/0-entry.png` });

await page.click('#enter');
await page.waitForTimeout(FADE_WAIT_MS);

const sampleCanvas = () => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => setTimeout(() => {}, 0));
  requestAnimationFrame(() => {
    const gl = window.__xiu.renderer.gl;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const values = [];
    const GRID = 16;
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      gl.readPixels(Math.floor((x + 0.5) * w / GRID), Math.floor((y + 0.5) * h / GRID), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      values.push(px[0], px[1], px[2]);
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    resolve({ mean, sd });
  });
}));

const state = () => page.evaluate(() => {
  const { score, viewer, audio, renderer } = window.__xiu;
  return {
    audio: audio.context?.state, fade: score.fade, heading: viewer.heading, y: viewer.position[1],
    speed: viewer.speed.value, convergence: renderer.convergence, glow: score.glow, sparkle: score.sparkle,
    misreg: score.misreg, renderScale: renderer.renderScale,
  };
});

const s1 = await state();
console.log('after entry', s1);
check(s1.audio === 'running', `audio context running (${s1.audio})`);
check(s1.fade > 0.99, `faded in (${s1.fade.toFixed(2)})`);
check(s1.glow > 0.05, `audio feeds back into picture: glow=${s1.glow.toFixed(3)}`);
const px = await sampleCanvas();
check(px.sd > MIN_PIXEL_STDDEV, `canvas has image content (stddev ${px.sd.toFixed(1)}, mean ${px.mean.toFixed(1)})`);
await page.screenshot({ path: `${OUT_DIR}/1-world.png` });

const fps = await page.evaluate((ms) => new Promise((resolve) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(n / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(tick);
}), FPS_SAMPLE_MS);
const s2 = await state();
// Resolution must settle, not pump (owner saw shimmer; scale was sawtoothing).
const scaleChanges = await page.evaluate(() => new Promise((resolve) => {
  const r = window.__xiu.renderer; let last = r.renderScale, changes = 0; const t0 = performance.now();
  const tick = () => { if (r.renderScale !== last) { changes++; last = r.renderScale; } performance.now() - t0 < 10000 ? requestAnimationFrame(tick) : resolve(changes); };
  requestAnimationFrame(tick);
}));
check(scaleChanges <= MAX_SCALE_CHANGES_10S, `render scale settles (${scaleChanges} changes in 10 s, max ${MAX_SCALE_CHANGES_10S})`);
check(fps >= MIN_FPS, `frame rate ${fps.toFixed(1)} fps (render scale ${s2.renderScale.toFixed(2)})`);

// Lean right and up.
await page.mouse.move(VIEWPORT.width * 0.95, VIEWPORT.height * 0.2, { steps: 10 });
await page.waitForTimeout(LEAN_MS);
const s3 = await state();
console.log('after lean', s3);
const turned = ((s3.heading - s2.heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
check(turned > 0.3, `leaning right turns right (Δheading ${turned.toFixed(2)} rad)`);
check(s3.y > s2.y, `leaning up climbs (${s2.y.toFixed(2)} → ${s3.y.toFixed(2)})`);
check(s3.speed > s2.speed, `leaning speeds up (${s2.speed.toFixed(2)} → ${s3.speed.toFixed(2)})`);
check(s3.misreg > s2.misreg, `speed raises misregistration (${s2.misreg.toFixed(2)} → ${s3.misreg.toFixed(2)})`);
await page.screenshot({ path: `${OUT_DIR}/2-leaning.png` });

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
process.exit(failures.length ? 1 : 0);

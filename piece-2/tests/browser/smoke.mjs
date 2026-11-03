// Piece 2 browser smoke test (real Chrome + Metal). Usage: npm run dev; npm run test:browser
// Checks: no console errors, audio running, canvas content, frame rate, stable
// resolution, 12-15 jellies, a staged merge (screenshots squash -> blend -> one).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.XIU_URL ?? 'http://127.0.0.1:5180/';
const OUT = process.env.XIU_OUT ?? 'tests/browser/out';
const VIEWPORT = { width: 1280, height: 800 };
const MIN_FPS = 50, MIN_PIXEL_STDDEV = 8, MAX_SCALE_CHANGES_10S = 3;
mkdirSync(OUT, { recursive: true });
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };

const browser = await chromium.launch({ channel: 'chrome', headless: process.env.XIU_HEADLESS !== '0',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL);
await page.waitForFunction(() => window.__xiu?.renderer);
await page.screenshot({ path: `${OUT}/0-entry.png` });
await page.click('#enter');
await page.waitForTimeout(7000);

const state = () => page.evaluate(() => {
  const { score, field, renderer, sound } = window.__xiu;
  return { audio: sound.context?.state, fade: score.fade, count: field.bodies.length, merges: field.merges, scale: renderer.renderScale };
});
const s1 = await state();
console.log(s1);
check(s1.audio === 'running', `audio running (${s1.audio})`);
check(s1.count >= 12 && s1.count <= 15, `12-15 jellies (${s1.count})`);
const inView = await page.evaluate(() => {
  // In the camera frustum (60 deg vertical FOV, window aspect).
  const { field, viewer } = window.__xiu, B = viewer.basis(new Float32Array(9)), p = viewer.position;
  const tanV = Math.tan(Math.PI / 6), tanH = tanV * innerWidth / innerHeight;
  return field.bodies.filter((b) => {
    const d = [0, 1, 2].map((k) => b.center[k] - p[k]);
    const x = d[0] * B[0] + d[1] * B[1] + d[2] * B[2], y = d[0] * B[3] + d[1] * B[4] + d[2] * B[5], z = d[0] * B[6] + d[1] * B[7] + d[2] * B[8];
    return z > 0 && Math.abs(x) < z * tanH + b.radius && Math.abs(y) < z * tanV + b.radius;
  }).length;
});
check(inView >= 9, `most jellies are in view (${inView} of ${s1.count})`);
const px = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => {
  const gl = window.__xiu.renderer.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, p = new Uint8Array(4), v = [];
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) { gl.readPixels(Math.floor((x + .5) * w / 24), Math.floor((y + .5) * h / 24), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); v.push(p[0], p[1], p[2]); }
  const m = v.reduce((a, b) => a + b, 0) / v.length; res({ mean: m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) });
})));
check(px.sd > MIN_PIXEL_STDDEV, `canvas has content (stddev ${px.sd.toFixed(1)}, mean ${px.mean.toFixed(1)})`);
await page.screenshot({ path: `${OUT}/1-flight.png` });

const scaleChanges = await page.evaluate(() => new Promise((resolve) => {
  const r = window.__xiu.renderer; let last = r.renderScale, n = 0; const t0 = performance.now();
  const tick = () => { if (r.renderScale !== last) { n++; last = r.renderScale; } performance.now() - t0 < 10000 ? requestAnimationFrame(tick) : resolve(n); };
  requestAnimationFrame(tick);
}));
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
const s2 = await state();
check(scaleChanges <= MAX_SCALE_CHANGES_10S, `render scale settles (${scaleChanges} changes in 10 s)`);
check(fps >= MIN_FPS, `frame rate ${fps.toFixed(1)} fps (render scale ${s2.scale.toFixed(2)})`);

// Stage a merge in front of the viewer.
await page.evaluate(async () => {
  const { field, viewer } = window.__xiu;
  const { JellyBody, rng } = await import('/src/jellies/body.js');
  const f = viewer.forward, p = viewer.position, right = [f[2], 0, -f[0]];
  const at = (side, dist) => [0, 1, 2].map((k) => p[k] + f[k] * dist + right[k] * side);
  const toward = (dir) => [0, 1, 2].map((k) => right[k] * dir * 0.7); // dir +1 = towards screen-right
  // Clear the stage: nothing else between us and the pair.
  field.bodies = field.bodies.filter((b) => Math.hypot(...[0, 1, 2].map((k) => b.center[k] - at(0, 9)[k])) > 7);
  field.bodies.push(
    new JellyBody({ center: at(-2.6, 9), velocity: toward(1), radius: 1.6, random: rng(1), look: 'zebra', color: '#ff4d6d', color2: '#3a5bff' }),
    new JellyBody({ center: at(2.6, 9), velocity: toward(-1), radius: 1.3, random: rng(2), look: 'sprinkle', color: '#62c934', color2: '#ffc61a' }),
  );
  window.__stagedIds = field.bodies.slice(-2).map((b) => b.id);
  viewer.setLean(0, 0, false);
  viewer.speed.value = 0; viewer.speed.velocity = 0; viewer.turn.value = 0; viewer.turn.velocity = 0;
  viewer.c = { ...viewer.c, baseSpeed: 0, wanderTurnRate: 0 };
});
for (const [i, ms] of [[0, 1200], [1, 1200], [2, 1500], [3, 2500]]) {
  await page.waitForTimeout(ms);
  await page.screenshot({ path: `${OUT}/merge-${i}.png` });
}
const merged = await page.evaluate(() => { const ids = new Set(window.__xiu.field.bodies.map((b) => b.id)); return window.__stagedIds.every((id) => !ids.has(id)); });
check(merged, 'the staged pair fused into one');
check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
process.exit(failures.length ? 1 : 0);

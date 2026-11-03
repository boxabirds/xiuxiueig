// New jellies fade in (owner request); merged ones do not. Also captures a
// close-up for checking the round softbox highlight.
// Usage: npm run dev; node tests/browser/fade-in.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.env.XIU_URL ?? 'http://127.0.0.1:5180/';
const OUT = process.env.XIU_OUT ?? 'tests/browser/out';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.goto(URL);
await page.waitForFunction(() => window.__xiu?.renderer);
await page.evaluate(async () => {
  const { score, viewer, field, renderer } = window.__xiu;
  document.getElementById('enter').style.display = 'none';
  score.fade = 1; score.entered = true;
  viewer.step = function () { return this; }; // frozen camera
  field.bodies = []; field.manage = false; field.gravityOn = false;
  renderer.setRenderScale(0.6); renderer.setRenderScale = () => {};
  const { JellyBody, rng } = await import('/src/jellies/body.js');
  const p = viewer.position, f = viewer.forward;
  const at = (dist) => [0, 1, 2].map((k) => p[k] + f[k] * dist);
  window.__fresh = new JellyBody({ center: at(7), velocity: [0, 0, 0], radius: 1.8, random: rng(7), look: 'classic', color: '#3a5bff', color2: '#ff4d6d' });
  field.bodies.push(window.__fresh);
});
// Mean brightness of the central region, where the jelly sits.
const centre = () => page.evaluate(() => new Promise((res) => requestAnimationFrame(() => {
  const gl = window.__xiu.renderer.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4); let s = 0, n = 0;
  for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) { gl.readPixels(Math.floor(w / 2 + x * w / 60), Math.floor(h / 2 + y * h / 60), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); s += px[0] + px[1] + px[2]; n += 3; }
  res(s / n);
})));
await page.waitForTimeout(300);
const early = await centre();
await page.screenshot({ path: `${OUT}/fade-early.png` });
await page.waitForTimeout(3200);
const late = await centre();
await page.screenshot({ path: `${OUT}/fade-late.png` });
console.log(`centre brightness: at ~0.3 s ${early.toFixed(1)}, at ~3.5 s ${late.toFixed(1)}`);
const ok = late > 20 && early < late * 0.5;
console.log(ok ? 'PASS new jelly fades in' : 'FAIL fade-in');
await browser.close();
process.exit(ok ? 0 : 1);

// Floor quality (owner feedback: "very high frequency sparkly and doesn't seem
// to change much"). Pins the viewer looking down at the floor and captures:
//   a, a2: two consecutive moments 0.25 s apart  -> shimmer
//   b:     the same view 120 s of world time later -> evolution
// Metrics are computed by tests/browser/floor_metrics.py.
// Usage: npm run dev, then node tests/browser/floor.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.XIU_URL ?? 'http://127.0.0.1:5179/';
const OUT_DIR = process.env.XIU_OUT ?? 'tests/browser/out';
const PITCH_DOWN = -0.75;
const ALTITUDE = 1.6;
const EVOLVE_S = 120;
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.goto(URL);
await page.waitForFunction(() => window.__xiu?.renderer);
await page.evaluate(([pitch, y]) => {
  const { score, viewer } = window.__xiu;
  document.getElementById('enter').style.display = 'none';
  score.fade = 1; score.entered = true;
  score.advance(200, viewer);
  viewer.step = function () { this.pitch.value = pitch; this.pitch.velocity = 0; this.position[1] = y; this.roll = 0; return this; };
}, [PITCH_DOWN, ALTITUDE]);
// Measure steady state: wait until the adaptive resolution has held for 3 s.
await page.evaluate(() => new Promise((resolve) => {
  const r = window.__xiu.renderer; let last = r.renderScale, since = performance.now();
  const tick = () => {
    if (r.renderScale !== last) { last = r.renderScale; since = performance.now(); }
    performance.now() - since > 3000 ? resolve() : requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));
// Screenshots stall a frame, which would itself trigger a resolution drop and
// make a/a2 differ for reasons a viewer never sees. Freeze the settled scale.
// (Real-world stability is checked by smoke.mjs without screenshots.)
await page.evaluate(() => { window.__xiu.renderer.setRenderScale = () => {}; });
const scaleA = await page.evaluate(() => window.__xiu.renderer.renderScale);
await page.screenshot({ path: `${OUT_DIR}/floor-a.png` });
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT_DIR}/floor-a2.png` });
const scaleA2 = await page.evaluate(() => window.__xiu.renderer.renderScale);
console.log(`render scale at a: ${scaleA.toFixed(3)}, at a2: ${scaleA2.toFixed(3)}`);
await page.evaluate((s) => { const { score, viewer } = window.__xiu; score.advance(s, viewer); }, EVOLVE_S);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT_DIR}/floor-b.png` });
await browser.close();
console.log(`saved ${OUT_DIR}/floor-{a,a2,b}.png`);

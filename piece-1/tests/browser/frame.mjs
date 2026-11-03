// Deterministic frame capture for image-quality A/B: freezes world time and the
// viewer, pins the render scale, and saves one screenshot.
// Usage: npm run dev; node tests/browser/frame.mjs <out.png> [worldSeconds] [renderScale]
import { chromium } from 'playwright';

const [out = 'tests/browser/out/frame.png', worldS = '300', scale = '0.5'] = process.argv.slice(2);
const URL = process.env.XIU_URL ?? 'http://127.0.0.1:5179/';
const SETTLE_MS = 2500;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.goto(URL);
await page.waitForFunction(() => window.__xiu?.renderer);
await page.evaluate(([w, sc]) => {
  const { score, viewer, renderer } = window.__xiu;
  document.getElementById('enter').style.display = 'none';
  score.fade = 1; score.entered = true;
  score.advance(w, viewer);
  score.update = function () { return this; };
  viewer.step = function () { return this; };
  renderer.setRenderScale(sc);
  renderer.setRenderScale = () => {};
}, [Number(worldS), Number(scale)]);
await page.waitForTimeout(SETTLE_MS);
await page.screenshot({ path: out });
await browser.close();
console.log(`saved ${out}`);

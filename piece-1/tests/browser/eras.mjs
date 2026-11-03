// Visual evidence for long-period evolution: screenshots of the same session
// jumped forward through the eras. Also crops for judging aliasing.
// Usage: npm run dev, then node tests/browser/eras.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.XIU_URL ?? 'http://127.0.0.1:5179/';
const OUT_DIR = process.env.XIU_OUT ?? 'tests/browser/out';
const MOMENTS_S = [0, 240, 540, 1500];
const SETTLE_MS = 2500;
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL);
await page.waitForFunction(() => window.__xiu?.renderer);
await page.evaluate(() => { window.__xiu.score.fade = 1; window.__xiu.score.entered = true; });
let previous = 0;
for (const t of MOMENTS_S) {
  await page.evaluate((dt) => { const { score, viewer } = window.__xiu; if (dt > 0) score.advance(dt, viewer); }, t - previous);
  previous = t;
  await page.waitForTimeout(SETTLE_MS);
  const era = await page.evaluate(() => {
    const e = window.__xiu.score.era;
    return { family: [...e.family].map((x) => +x.toFixed(2)), scale: +e.scale.toFixed(2), turbulence: +e.turbulence.toFixed(2), thickness: +e.thickness.toFixed(2), saturation: +e.saturation.toFixed(2) };
  });
  console.log(`t=${t}s`, JSON.stringify(era));
  await page.screenshot({ path: `${OUT_DIR}/era-${t}s.png` });
}
console.log(errors.length ? `ERRORS: ${errors.join(' | ')}` : 'no errors');
await browser.close();

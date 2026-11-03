// Does the viewer's position/motion change the sound? (Breath pinned so its
// 13 s swell does not confound the comparison.) Measures the real audio
// output (AnalyserNode) while the viewer is held in different states.
// Usage: npm run dev, then node tests/browser/position-sound.mjs
import { chromium } from 'playwright';

const URL = process.env.XIU_URL ?? 'http://127.0.0.1:5179/';
const HOLD_MS = 9000;
const SAMPLE_MS = 5000;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL);
await page.waitForFunction(() => window.__xiu?.renderer);
await page.click('#enter');
await page.waitForTimeout(7000);

// Spectral centroid (Hz) and level (dB) of the live output, averaged over SAMPLE_MS.
const measure = () => page.evaluate((ms) => new Promise((res) => {
  const { audio, score } = window.__xiu;
  const hzPerBin = audio.context.sampleRate / (audio.spectrum.length * 2);
  let c = 0, lvl = 0, n = 0, alt = 0, agit = 0, mis = 0;
  const id = setInterval(() => {
    let num = 0, den = 0;
    for (let i = 1; i < audio.spectrum.length; i++) { const p = 10 ** (audio.spectrum[i] / 10); num += p * i * hzPerBin; den += p; }
    c += num / den; lvl += 10 * Math.log10(den); alt += score.altitude; agit += score.agitation; mis += score.misreg; n++;
  }, 100);
  setTimeout(() => { clearInterval(id); res({ centroidHz: c / n, levelDb: lvl / n, altitude: alt / n, agitation: agit / n, misreg: mis / n }); }, ms);
}), SAMPLE_MS);

const hold = async (x, y) => {
  await page.evaluate(([x, y]) => { const BREATH_PIN = Math.PI / 2; // pin breath at mid-swell to remove its confound
    const v = window.__xiu.viewer; const sc = window.__xiu.score; v._lean = setInterval(() => { v.setLean(x, y, true); sc.breathPhase = BREATH_PIN; }, 20); }, [x, y]);
  await page.waitForTimeout(HOLD_MS);
  const m = await measure();
  await page.evaluate(() => clearInterval(window.__xiu.viewer._lean));
  return m;
};
const fmt = (m) => `centroid ${m.centroidHz.toFixed(0)} Hz, level ${m.levelDb.toFixed(1)} dB | altitude ${m.altitude.toFixed(2)} agitation ${m.agitation.toFixed(2)} misreg ${m.misreg.toFixed(2)}`;

const low = await hold(0, -1);       // dive and stay low
console.log('LOW, diving:   ', fmt(low));
const high = await hold(0, 1);       // climb and stay high
console.log('HIGH, climbing:', fmt(high));
const still = await hold(0, 0);      // no lean: drifting
console.log('STILL, drift:  ', fmt(still));
const fast = await hold(1, 0);       // full lean sideways: fast, agitated
console.log('FAST, leaning: ', fmt(fast));
await browser.close();

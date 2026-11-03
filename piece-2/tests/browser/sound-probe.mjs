// Measures piece 2's live audio: drone present, and a staged merge adds squish +
// plop energy (2-6 kHz band and overall level) above the drone.
// Usage: npm run dev; node tests/browser/sound-probe.mjs
import { chromium } from 'playwright';
const URL = process.env.XIU_URL ?? 'http://127.0.0.1:5180/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL);
await page.waitForFunction(() => window.__xiu?.renderer);
await page.click('#enter');
await page.waitForTimeout(7000);
const result = await page.evaluate(async () => {
  const { sound, field, viewer } = window.__xiu;
  const an = sound.context.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
  sound.node.connect(an);
  const time = new Float32Array(an.fftSize), freq = new Float32Array(an.frequencyBinCount);
  const hz = sound.context.sampleRate / an.fftSize;
  const sample = () => {
    an.getFloatTimeDomainData(time); an.getFloatFrequencyData(freq);
    let s = 0; for (const x of time) s += x * x;
    let hi = 0, n = 0; for (let b = Math.round(2000 / hz); b < Math.round(6000 / hz); b++) { hi += 10 ** (freq[b] / 10); n++; }
    return { rms: Math.sqrt(s / time.length), hi: 10 * Math.log10(hi / n + 1e-20) };
  };
  const series = async (ms) => { const out = []; const t0 = performance.now(); while (performance.now() - t0 < ms) { out.push(sample()); await new Promise((r) => setTimeout(r, 25)); } return out; };
  const before = await series(2000);
  // Stage a head-on merge right in front.
  const { JellyBody, rng } = await import('/src/jellies/body.js');
  const f = viewer.forward, p = viewer.position, right = [f[2], 0, -f[0]];
  const at = (side) => [0, 1, 2].map((k) => p[k] + f[k] * 6 + right[k] * side);
  viewer.c = { ...viewer.c, baseSpeed: 0, wanderTurnRate: 0 }; viewer.speed.value = 0;
  field.bodies.push(
    new JellyBody({ center: at(-2.4), velocity: right.map((x) => x * 0.9), radius: 1.3, random: rng(5), look: 'classic', color: '#9b5cff', color2: '#ffc61a' }),
    new JellyBody({ center: at(2.4), velocity: right.map((x) => -x * 0.9), radius: 1.1, random: rng(6), look: 'classic', color: '#ffc61a', color2: '#9b5cff' }));
  const m0 = field.merges;
  const during = await series(4000);
  return { before, during, merged: field.merges > m0, plops: sound.values[sound.values.length - 4] };
});
const stat = (arr, k) => { const v = arr.map((x) => x[k]).sort((a, b) => a - b); return { median: v[v.length >> 1], max: v.at(-1) }; };
const b = { rms: stat(result.before, 'rms'), hi: stat(result.before, 'hi') }, d = { rms: stat(result.during, 'rms'), hi: stat(result.during, 'hi') };
console.log(`drone before: rms median ${b.rms.median.toFixed(4)}, 2-6 kHz median ${b.hi.median.toFixed(1)} dB`);
console.log(`during merge: rms max ${d.rms.max.toFixed(4)}, 2-6 kHz max ${d.hi.max.toFixed(1)} dB; merged=${result.merged}`);
const ok = b.rms.median > 0.005 && result.merged && d.hi.max > b.hi.median + 12;
console.log(ok ? 'PASS sound: drone present, merge adds squish/plop energy' : 'FAIL sound');
await browser.close();
process.exit(ok ? 0 : 1);

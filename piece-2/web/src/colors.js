// Jelly colours as Unix Jelly derives them: a light surface tint and a deep,
// saturated attenuation colour, deepened relative to the colour's own
// lightness (a fixed dark turns yellow and orange brown).
const TINT_SAT_GAIN = 1.1, TINT_MIN_L = 0.62, DEEP_L_GAIN = 0.78, DEEP_MIN_L = 0.4;

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

export function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb([h, s, l]) {
  const f = (n) => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** { tint, deep } in linear RGB. */
export function jellyColors(hex) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const tint = hslToRgb([h, Math.min(1, s * TINT_SAT_GAIN), Math.max(TINT_MIN_L, l)]).map(toLinear);
  const deep = hslToRgb([h, 1, Math.max(DEEP_MIN_L, l * DEEP_L_GAIN)]).map(toLinear);
  return { tint, deep };
}

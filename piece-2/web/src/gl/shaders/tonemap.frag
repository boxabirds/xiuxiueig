// Neutral tone mapping (Khronos PBR Neutral): Unix Jelly found ACES greys the
// jelly colours; Neutral keeps sweets bright. Then sRGB gamma.
in vec2 vUv;
uniform sampler2D uScene;
out vec4 fragColor;
const float EXPOSURE = 1.0;
const float START_COMPRESSION = 0.76;
const float DESATURATION = 0.15;

vec3 neutral(vec3 color) {
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < START_COMPRESSION) return color;
  float d = 1.0 - START_COMPRESSION;
  float newPeak = 1.0 - d * d / (peak + d - START_COMPRESSION);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (DESATURATION * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

void main() {
  vec3 c = neutral(max(texture(uScene, vUv).rgb * EXPOSURE, 0.0));
  fragColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}

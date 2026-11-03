// FXAA while upscaling the LDR scene to the screen, then vignette, grain and
// the fade in from the silver entry screen. FXAA after the simplified
// FXAA 3.11 "console" formulation (Lottes): find the local edge direction from
// luma and blend along it.
in vec2 vUv;
uniform sampler2D uImage;   // LDR scene, linear filtering
uniform vec2 uTexel;        // 1 / scene resolution
uniform float uFade;
uniform float uGrainSeed;
out vec4 fragColor;
const vec3 SILVER_SCREEN = vec3(0.80, 0.81, 0.83);
const float VIGNETTE = 0.28;
const float GRAIN = 0.003; // dither only: 0.014 read as per-frame sparkle on the dark floor
const vec3 FXAA_LUMA = vec3(0.299, 0.587, 0.114);
const float FXAA_REDUCE_MIN = 1.0 / 128.0;
const float FXAA_REDUCE_MUL = 1.0 / 8.0;
const float FXAA_SPAN_MAX = 8.0;

vec3 fxaa(vec2 uv) {
  vec3 nw = texture(uImage, uv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 ne = texture(uImage, uv + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 sw = texture(uImage, uv + vec2(-1.0, 1.0) * uTexel).rgb;
  vec3 se = texture(uImage, uv + vec2(1.0, 1.0) * uTexel).rgb;
  vec3 m = texture(uImage, uv).rgb;
  float lNW = dot(nw, FXAA_LUMA), lNE = dot(ne, FXAA_LUMA);
  float lSW = dot(sw, FXAA_LUMA), lSE = dot(se, FXAA_LUMA);
  float lM = dot(m, FXAA_LUMA);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.25 * FXAA_REDUCE_MUL, FXAA_REDUCE_MIN);
  float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcpMin, vec2(-FXAA_SPAN_MAX), vec2(FXAA_SPAN_MAX)) * uTexel;
  vec3 a = 0.5 * (texture(uImage, uv + dir * (1.0 / 3.0 - 0.5)).rgb +
                  texture(uImage, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture(uImage, uv - dir * 0.5).rgb +
                             texture(uImage, uv + dir * 0.5).rgb);
  float lB = dot(b, FXAA_LUMA);
  return (lB < lMin || lB > lMax) ? a : b;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + uGrainSeed) * 43758.5453);
}

void main() {
  vec3 c = fxaa(vUv);
  vec2 v = vUv - 0.5;
  c *= 1.0 - VIGNETTE * dot(v, v) * 2.0;
  c += (hash(gl_FragCoord.xy) - 0.5) * GRAIN;
  fragColor = vec4(mix(SILVER_SCREEN, c, uFade), 1.0);
}

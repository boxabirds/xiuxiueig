// Temporal anti-aliasing (owner: "really stepped / low res ... Amiga demo").
// The scene is rendered with a per-frame sub-pixel jitter; this pass reprojects
// last frame's accumulated image through the camera motion using the
// first-surface depth (scene alpha), clips it to the current neighbourhood
// (variance clipping) to reject stale colour, and blends. Slow drift lets
// samples accumulate into a much higher effective resolution.
in vec2 vUv;
uniform sampler2D uCurrent;   // scene HDR, alpha = first-surface depth
uniform sampler2D uHistory;   // previous TAA output
uniform vec2 uTexel;          // 1 / scene resolution
uniform mat3 uBasis;          // current camera basis (right, up, forward)
uniform mat3 uPrevBasis;
uniform vec3 uCamDelta;       // current position - previous position (wrap-corrected)
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uHistoryValid;  // 0 after a reset (resize, first frame)
out vec4 fragColor;

const float BLEND = 0.1;             // weight of the new frame
const float CLIP_GAMMA = 1.25;       // variance-clip width (sigmas)
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// Karis tonemap weights keep bright outliers from dominating the blend.
vec3 compress(vec3 c) { return c / (1.0 + dot(c, LUMA)); }
vec3 expand(vec3 c) { return c / max(1.0 - dot(c, LUMA), 1e-4); }

void main() {
  vec4 cur = texture(uCurrent, vUv);
  vec3 c = compress(cur.rgb);

  // Neighbourhood statistics for variance clipping.
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 s = compress(texture(uCurrent, vUv + vec2(x, y) * uTexel).rgb);
      m1 += s;
      m2 += s * s;
    }
  }
  m1 /= 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
  vec3 lo = m1 - CLIP_GAMMA * sigma;
  vec3 hi = m1 + CLIP_GAMMA * sigma;

  // Reproject: world point of this pixel's first surface, seen from last frame.
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uBasis * vec3(ndc.x * uAspect * uTanHalfFov, ndc.y * uTanHalfFov, 1.0));
  vec3 pRel = rd * cur.a + uCamDelta;                // relative to previous camera
  vec3 v = transpose(uPrevBasis) * pRel;
  vec2 prevNdc = vec2(v.x / (v.z * uAspect * uTanHalfFov), v.y / (v.z * uTanHalfFov));
  vec2 prevUv = prevNdc * 0.5 + 0.5;
  bool onScreen = v.z > 0.0 && all(greaterThanEqual(prevUv, vec2(0.0))) && all(lessThanEqual(prevUv, vec2(1.0)));

  float w = (uHistoryValid > 0.5 && onScreen) ? BLEND : 1.0;
  vec3 h = clamp(compress(texture(uHistory, prevUv).rgb), lo, hi);
  fragColor = vec4(expand(mix(h, c, w)), 1.0);
}

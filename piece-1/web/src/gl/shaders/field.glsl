// Shared signed distance field: the same jelly for the scene raymarch and the
// caustic light rays. Every spatial frequency is an integer multiple of K0, so
// the field is exactly periodic in x/z (see world.js). Every phase uniform is
// used with an integer multiplier, so wrapping it at 2pi is seamless.
//
// Eras (minute-scale, from the Score) morph the surface family (gyroid,
// Schwarz D, Schwarz P), the cell scale, turbulence, thickness and colour
// depth, so the world changes character over an hour instead of seconds.

uniform vec3 uWarp;          // warp phases, wrapped [0, 2pi)
uniform vec3 uWobble;        // wobble modes, -1..1 (same values the synth gets)
uniform float uBreath;       // 0..1, 13 s
uniform float uChaos;        // Benjolin, -1..1
uniform vec3 uCamPos;        // viewer (personal bubble centre)
uniform float uFlavorPhase;  // wrapped [0, 2pi)
uniform float uFlavorAngle;  // heading, wrapped [0, 2pi)
uniform vec3 uFamily;        // era: weights of gyroid, Schwarz D, Schwarz P (sum 1)
uniform float uEraScale;     // era: 0 fine cells .. 1 coarse cells
uniform float uEraTurbulence;// era: 0 calm .. 1 turbulent
uniform float uEraThickness; // era: 0 gossamer .. 1 gummy
uniform float uEraSaturation;// era: 0 pale .. 1 deep
uniform float uEraDrift;     // era: very slow large-scale warp phase

const float CELL_K_FINE = 32.0 * K0;
const float CELL_K_COARSE = 20.0 * K0;
const float SCALE_BLEND_EPS = 0.02;
const float P_NORM = 0.5;          // Schwarz P spans +-3; bring it to +-1.5
const float REGION_WEIGHT = 0.45;  // spatial variation of family weights
const float THICKNESS_BASE = 0.10;
const float THICKNESS_ERA = 0.22;
const float THICKNESS_BREATH = 0.26;
const float WARP_AMP = 1.1;
const float WARP_CHAOS = 0.25;
const float TURBULENCE_MIN = 0.45;
const float TURBULENCE_RANGE = 1.15;
const float WOBBLE_AMP_0 = 0.75;
const float WOBBLE_AMP_1 = 0.6;
const float WOBBLE_AMP_2 = 0.9;
const float DRIFT_AMP_0 = 3.5;
const float DRIFT_AMP_1 = 2.2;
const float LIPSCHITZ_BASE = 2.4;
const float LIPSCHITZ_TURBULENCE = 1.4;
const float BAND_SOFTNESS = 1.4;
const float BUBBLE_RADIUS = 1.7;
const float BUBBLE_SOFTNESS = 1.0;

// Jelly Baby flavour absorption coefficients (per metre), plus three new ones.
const int FLAVOR_COUNT = 7;
const vec3 FLAVORS[FLAVOR_COUNT] = vec3[FLAVOR_COUNT](
  vec3(48.0, 3.2, 85.0),   // lime
  vec3(10.0, 44.0, 56.0),  // strawberry
  vec3(14.0, 8.0, 3.0),    // blueberry
  vec3(8.0, 8.0, 112.0),   // lemon
  vec3(30.0, 70.0, 6.0),   // grape
  vec3(4.0, 30.0, 95.0),   // tangerine
  vec3(60.0, 40.0, 10.0)   // ink
);
const float ABSORPTION_SCALE = 0.11;
const float SATURATION_MIN = 0.9;   // even pale eras tint thin sheets
const float SATURATION_RANGE = 1.4;

float smax(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
  return mix(b, a, h) + k * h * (1.0 - h);
}

float turbulence() {
  return TURBULENCE_MIN + TURBULENCE_RANGE * uEraTurbulence;
}

vec3 warpDomain(vec3 p) {
  vec3 q = p;
  // Very large, very slow drift: whole regions slide and fold over minutes.
  q += DRIFT_AMP_0 * sin(p.zxy * (3.0 * K0) + vec3(uEraDrift, -uEraDrift, 2.0 * uEraDrift));
  q += DRIFT_AMP_1 * cos(p.yzx * (5.0 * K0) - vec3(2.0 * uEraDrift, uEraDrift, -uEraDrift));
  float turb = turbulence();
  q += turb * WARP_AMP * (1.0 + WARP_CHAOS * uChaos) * sin(p.yzx * (24.0 * K0) + uWarp);
  q += turb * WOBBLE_AMP_0 * uWobble.x * sin(p.zxy * (40.0 * K0) + uWarp.yzx);
  q += turb * WOBBLE_AMP_1 * uWobble.y * cos(p.xzy * (52.0 * K0) - uWarp.zxy);
  q.y += turb * WOBBLE_AMP_2 * uWobble.z * sin((p.x + p.z) * (20.0 * K0) + uWarp.x);
  return q;
}

/** Triply periodic minimal surfaces from one set of sin/cos. */
float tpms(vec3 q, vec3 w) {
  vec3 s = sin(q);
  vec3 c = cos(q);
  float g = dot(s, c.yzx);
  float d = s.x * s.y * s.z + s.x * c.y * c.z + c.x * s.y * c.z + c.x * c.y * s.z;
  float pz = (c.x + c.y + c.z) * P_NORM;
  return w.x * g + w.y * d + w.z * pz;
}

vec3 familyWeights(vec3 p) {
  float region = sin(p.x * (3.0 * K0) + uEraDrift) * sin(p.z * (2.0 * K0) - uEraDrift);
  vec3 w = max(uFamily + REGION_WEIGHT * vec3(region, -region, 0.5 * region), vec3(0.0));
  return w / max(w.x + w.y + w.z, 1e-3);
}

/** Raw blended surface value (before abs/thickness): smooth, so it can be
 *  baked into a 3D texture and interpolated without losing crisp sheets. */
float fieldValueAnalytic(vec3 p) {
  vec3 q = warpDomain(p);
  vec3 w = familyWeights(p);
  if (uEraScale < SCALE_BLEND_EPS) return tpms(q * CELL_K_FINE, w);
  if (uEraScale > 1.0 - SCALE_BLEND_EPS) return tpms(q * CELL_K_COARSE, w);
  return mix(tpms(q * CELL_K_FINE, w), tpms(q * CELL_K_COARSE, w), uEraScale);
}

#ifdef USE_VOLUME
uniform highp sampler3D uVolume;  // fieldValueAnalytic baked around the viewer
uniform vec3 uVolOrigin;
uniform vec3 uVolExtent;
float fieldValue(vec3 p) {
  vec3 uvw = (p - uVolOrigin) / uVolExtent;
  if (all(greaterThan(uvw, vec3(0.0))) && all(lessThan(uvw, vec3(1.0)))) {
    return texture(uVolume, uvw.xzy).r; // texture axes: s = x, t = z, r = y
  }
  return fieldValueAnalytic(p); // beyond the baked volume (far, mostly fogged)
}
#else
float fieldValue(vec3 p) { return fieldValueAnalytic(p); }
#endif

// Sheets are at most this far (world units) from any point; beyond it the band
// term alone decides, so the surface need not be evaluated.
const float SHEET_MAX = 2.5;
const float BAND_SKIP = SHEET_MAX + BAND_SOFTNESS;

float shapeField(vec3 p, float value) {
  float band = max(BAND_BOTTOM - p.y, p.y - BAND_TOP);
  float bubble = BUBBLE_RADIUS - distance(p, uCamPos);
  float k = mix(CELL_K_FINE, CELL_K_COARSE, uEraScale);
  float thickness = THICKNESS_BASE + THICKNESS_ERA * uEraThickness + THICKNESS_BREATH * uBreath;
  float lipschitz = LIPSCHITZ_BASE + LIPSCHITZ_TURBULENCE * uEraTurbulence;
  float sheet = (abs(value) - thickness) / (k * lipschitz);
  return smax(smax(sheet, band, BAND_SOFTNESS), bubble, BUBBLE_SOFTNESS);
}

bool beyondBand(vec3 p) {
  return max(BAND_BOTTOM - p.y, p.y - BAND_TOP) > BAND_SKIP;
}

/** Exact field: analytic everywhere (used near surfaces and for normals). */
float fieldExact(vec3 p) {
  if (beyondBand(p)) {
    return smax(max(BAND_BOTTOM - p.y, p.y - BAND_TOP), BUBBLE_RADIUS - distance(p, uCamPos), BUBBLE_SOFTNESS);
  }
  return shapeField(p, fieldValueAnalytic(p));
}

/** Fast field for travelling: the baked volume. Its trilinear interpolation
 *  is noisy at surfaces (measured 4-6x more speckle than exact; 32-bit floats
 *  did not help). Fixing that in the march loop cost ~6 ms and half the
 *  resolution; temporal anti-aliasing (taa.frag) removes the speckle instead
 *  (measured ~0%), so only the normals use the exact field. */
float field(vec3 p) {
  if (beyondBand(p)) return fieldExact(p);
  return shapeField(p, fieldValue(p));
}

const float NORMAL_EPS = 0.015; // exact normals: speckle-free surfaces
const float NORMAL_EPS_FAST = 0.12; // ~half a voxel: smooths trilinear facets

/** Cheap normal from the travelling field (volume): for caustic rays, whose
 *  result is blurred anyway. */
vec3 fieldNormalFast(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * field(p + k.xyy * NORMAL_EPS_FAST) +
    k.yyx * field(p + k.yyx * NORMAL_EPS_FAST) +
    k.yxy * field(p + k.yxy * NORMAL_EPS_FAST) +
    k.xxx * field(p + k.xxx * NORMAL_EPS_FAST));
}
vec3 fieldNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * fieldExact(p + k.xyy * NORMAL_EPS) +
    k.yyx * fieldExact(p + k.yyx * NORMAL_EPS) +
    k.yxy * fieldExact(p + k.yxy * NORMAL_EPS) +
    k.xxx * fieldExact(p + k.xxx * NORMAL_EPS));
}

/** Absorption sigma (world units) from a drifting, cyclic flavour field. */
vec3 absorptionAt(vec3 p) {
  float a = sin(p.x * (8.0 * K0) + p.y * 0.23 + uFlavorPhase);
  float b = sin(p.z * (12.0 * K0) - p.y * 0.17 + 2.0 * uFlavorPhase);
  float c = sin((p.x - p.z) * (16.0 * K0) - uFlavorPhase);
  float f = (a * cos(uFlavorAngle) + b * sin(uFlavorAngle) + 0.5 * c) * 0.6 + 0.5;
  float idx = fract(f) * float(FLAVOR_COUNT);
  int i = int(floor(idx));
  int j = (i + 1) % FLAVOR_COUNT;
  float depth = ABSORPTION_SCALE * (SATURATION_MIN + SATURATION_RANGE * uEraSaturation);
  return mix(FLAVORS[i], FLAVORS[j], smoothstep(0.0, 1.0, fract(idx))) * depth;
}

// Shared march constants.
const float HIT_EPS = 0.004;
const float STEP_SCALE = 0.9;
const float MIN_INNER_STEP = 0.03;
const float JELLY_F0 = 0.022; // ((1.35-1)/(1.35+1))^2

float schlick(float cosTheta) {
  return JELLY_F0 + (1.0 - JELLY_F0) * pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
}

// The world: march to a jelly membrane, Fresnel-reflect the sky, refract in,
// march through to measure thickness, absorb per channel (Beer-Lambert), and
// refract out. Repeat for a few layers. The last exit refracts per channel, so
// the background (silver floor with caustics, or sky) splits into three
// misregistered plates.
in vec2 vUv;
uniform vec2 uResolution;
uniform vec2 uJitter;     // sub-pixel offset in pixels (TAA)
uniform mat3 uCamBasis;
uniform float uTanHalfFov;
uniform vec3 uIor;
uniform vec3 uSky0;  // zenith
uniform vec3 uSky1;  // horizon
uniform vec3 uSky2;  // accent
uniform float uSkyPhase;
uniform float uAltitude;
uniform float uGlow;
uniform float uSparkle;
uniform sampler2D uCaustic;
uniform vec2 uTileOrigin;
uniform float uTileExtent;
uniform vec3 uLightDir;
out vec4 fragColor;

const int MAX_LAYERS = 2;
const float SKY_DEPTH = 10000.0;
const int OUTER_STEPS = 80;
const int INNER_STEPS = 32;
const float MAX_DIST = 55.0;
const float FOG_DENSITY = 0.014;
const float REFLECT_GAIN = 0.8;
const float GLOW_GAIN = 0.8;
const float GLOW_BASE = 0.14; // flavour colour glows even in thin sheets
const float GLOW_REF_LENGTH = 1.2;
const float LIGHT_INTENSITY = 1.15;
const float AMBIENT = 0.12; // shadowed floor goes dark; caustic folds pop
const vec3 SILVER = vec3(0.42, 0.43, 0.46); // dark polished silver: a mirror for the coloured sky
const float FLOOR_F0 = 0.6;
const float FLOOR_SATIN = 0.8;
const float CAUSTIC_FALLBACK = 0.85;
const float CAUSTIC_EDGE = 0.08;
const float SPARKLE_GAIN = 0.6; // audio highs brighten the folds smoothly (no texel flicker)
const float CAUSTIC_PEAK = 4.0;
const float CAUSTIC_BEAD_BIAS = 2.0; // soft ceiling on focused light above the unfocused level
const float SKY_BAND_MIX = 0.35;
const float ALTITUDE_SKY_LIFT = 0.35;
const float SKY_GAIN = 0.55;          // deeper backdrop so lit jelly glows against it
const float SPEC_POWER = 180.0;       // crisp clearcoat glints (Jelly Baby: clearcoat .42, roughness .05)
const float SPEC_GAIN = 9.0;
const vec3 LIGHT_COLOR = vec3(1.0, 0.96, 0.9);
const float LIT_WRAP = 0.25;          // jelly faces away from the light keep some glow
const float FOG_ACCENT = 0.3;
const float FLOOR_TINT = 0.65; // polished silver mostly shows its surroundings

vec3 sky(vec3 rd) {
  float h = rd.y;
  vec3 base = mix(uSky1, uSky0, smoothstep(-0.15, 0.85, h));
  float az = atan(rd.z, rd.x);
  float bands = sin(az * 3.0 + h * 7.0 + uSkyPhase * 6.2831853)
              * sin(h * 13.0 - az * 2.0 - uSkyPhase * 12.566371);
  base = mix(base, uSky2, SKY_BAND_MIX * smoothstep(0.15, 1.0, bands));
  return base * SKY_GAIN * (1.0 + ALTITUDE_SKY_LIFT * (uAltitude - 0.5));
}

vec3 fogColor(vec3 rd) {
  return mix(uSky1, uSky2, FOG_ACCENT) * SKY_GAIN * (1.0 + ALTITUDE_SKY_LIFT * (uAltitude - 0.5));
}

// The floor is a slowly swelling mercury mirror (owner: the floor "doesn't seem
// to change much"). Ripple height breathes with the breath and grows in
// turbulent eras; phases ride the warp and drift clocks. Wave vectors are integer
// multiples of K0 per axis, so the floor wraps with the world.
const vec2 RIPPLE_K0 = vec2(16.0, 8.0) * K0;
const vec2 RIPPLE_K1 = vec2(-12.0, 24.0) * K0;
const vec2 RIPPLE_K2 = vec2(36.0, -28.0) * K0;
const vec3 RIPPLE_AMP = vec3(0.9, 0.55, 0.22);
const float RIPPLE_BASE = 0.35;
const float RIPPLE_BREATH = 0.35;

vec3 floorNormal(vec2 xz) {
  float gain = (RIPPLE_BASE + uEraTurbulence) * (1.0 - RIPPLE_BREATH + RIPPLE_BREATH * uBreath);
  vec2 slope = RIPPLE_AMP.x * RIPPLE_K0 * cos(dot(xz, RIPPLE_K0) + uWarp.x + uEraDrift)
             + RIPPLE_AMP.y * RIPPLE_K1 * cos(dot(xz, RIPPLE_K1) - uWarp.y + 2.0 * uEraDrift)
             + RIPPLE_AMP.z * RIPPLE_K2 * cos(dot(xz, RIPPLE_K2) + uWarp.z - uEraDrift);
  return normalize(vec3(-slope.x * gain, 1.0, -slope.y * gain));
}

vec3 floorShade(vec3 p, vec3 rd) {
  vec2 uv = (p.xz - uTileOrigin) / uTileExtent;
  // Mip bias ~ one ray spacing (grid 150 over 60 units -> ~4.6 texels): merges
  // the per-ray beads along folds into continuous lines.
  vec3 irr = texture(uCaustic, uv, CAUSTIC_BEAD_BIAS).rgb;
  vec2 edge = smoothstep(vec2(0.0), vec2(CAUSTIC_EDGE), uv) * smoothstep(vec2(0.0), vec2(CAUSTIC_EDGE), 1.0 - uv);
  irr = mix(vec3(CAUSTIC_FALLBACK), irr, edge.x * edge.y);
  // Focus can reach 60x; compress the excess so folds stay luminous lines, not
  // flat white blocks.
  vec3 excess = max(irr - 1.0, 0.0);
  irr = min(irr, vec3(1.0)) + CAUSTIC_PEAK * (1.0 + uSparkle * SPARKLE_GAIN) * excess / (excess + CAUSTIC_PEAK);
  vec3 albedo = mix(SILVER, uSky1, FLOOR_TINT);
  vec3 diffuse = albedo * (irr * LIGHT_INTENSITY + AMBIENT * uSky0);
  vec3 fn = floorNormal(p.xz);
  vec3 r = reflect(rd, fn);
  r.y = abs(r.y); // steep ripples must not reflect below the horizon
  float f = FLOOR_F0 + (1.0 - FLOOR_F0) * pow(1.0 - clamp(dot(-rd, fn), 0.0, 1.0), 5.0);
  return mix(diffuse, sky(r) * SILVER, f * FLOOR_SATIN);
}

/** Background along one ray from ro: the floor (with fog) or the sky. */
vec3 background(vec3 ro, vec3 rd) {
  if (rd.y < 0.0) {
    float t = (ro.y - FLOOR_Y) / -rd.y;
    vec3 p = ro + rd * t;
    float fog = exp(-t * FOG_DENSITY);
    return mix(fogColor(rd), floorShade(p, rd), fog);
  }
  return sky(rd);
}

bool marchOut(vec3 ro, vec3 rd, float tLimit, out float t) {
  t = 0.0;
  for (int i = 0; i < OUTER_STEPS; i++) {
    float d = field(ro + rd * t);
    if (d < HIT_EPS * (1.0 + t * 0.06)) return true;
    t += d * STEP_SCALE;
    if (t > tLimit) return false;
  }
  return true; // out of steps while still short of the limit: grazing a sheet, call it a hit
}

float marchIn(vec3 ro, vec3 rd) {
  float t = HIT_EPS * 4.0;
  for (int i = 0; i < INNER_STEPS; i++) {
    float d = -field(ro + rd * t);
    if (d < HIT_EPS) break;
    t += max(d * STEP_SCALE, MIN_INNER_STEP);
  }
  return t;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0 + uJitter * 2.0 / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec3 rd = normalize(uCamBasis * vec3(ndc.x * aspect * uTanHalfFov, ndc.y * uTanHalfFov, 1.0));
  vec3 ro = uCamPos;
  vec3 rdR = rd;
  vec3 rdB = rd;
  vec3 col = vec3(0.0);
  vec3 thr = vec3(1.0);
  float travelled = 0.0;
  // First-surface distance, written to alpha so the TAA pass can reproject.
  float depth = rd.y < 0.0 ? (ro.y - FLOOR_Y) / -rd.y : SKY_DEPTH;
  bool finished = false;

  for (int layer = 0; layer < MAX_LAYERS; layer++) {
    float tLimit = MAX_DIST - travelled;
    if (rd.y < 0.0) tLimit = min(tLimit, (ro.y - FLOOR_Y) / -rd.y);
    float t;
    if (!marchOut(ro, rd, tLimit, t)) {
      col += thr * vec3(background(ro, rdR).r, background(ro, rd).g, background(ro, rdB).b);
      finished = true;
      break;
    }
    // Air segment: volumetric fog.
    float fog = exp(-t * FOG_DENSITY);
    col += thr * (1.0 - fog) * fogColor(rd);
    thr *= fog;
    if (layer == 0) depth = t;
    travelled += t;

    vec3 p = ro + rd * t;
    vec3 n = fieldNormal(p);
    float F = schlick(dot(-rd, n));
    col += thr * F * REFLECT_GAIN * sky(reflect(rd, n));
    vec3 toLight = -uLightDir;
    vec3 h = normalize(toLight - rd);
    col += thr * SPEC_GAIN * pow(max(dot(n, h), 0.0), SPEC_POWER) * LIGHT_COLOR;
    float lit = LIT_WRAP + (1.0 - LIT_WRAP) * max(dot(n, toLight), 0.0);

    vec3 rIn = refract(rd, n, 1.0 / uIor.g);
    float len = marchIn(p, rIn);
    vec3 pe = p + rIn * len;
    vec3 sigma = absorptionAt(p + rIn * len * 0.5);
    vec3 trans = exp(-sigma * len);
    vec3 glowColor = exp(-sigma * GLOW_REF_LENGTH);
    col += thr * (1.0 - F) * glowColor * (GLOW_BASE + uGlow * GLOW_GAIN) * lit * (1.0 - exp(-len));
    thr *= (1.0 - F) * trans;

    vec3 ne = fieldNormal(pe);
    vec3 outG = refract(rIn, -ne, uIor.g);
    if (dot(outG, outG) < 0.5) outG = reflect(rIn, -ne);
    vec3 outR = refract(rIn, -ne, uIor.r);
    vec3 outB = refract(rIn, -ne, uIor.b);
    rdR = dot(outR, outR) < 0.5 ? outG : outR;
    rdB = dot(outB, outB) < 0.5 ? outG : outB;
    rd = outG;
    ro = pe + rd * HIT_EPS * 8.0;
    travelled += len;
  }
  if (!finished) {
    col += thr * vec3(background(ro, rdR).r, background(ro, rd).g, background(ro, rdB).b);
  }
  fragColor = vec4(col, min(depth, SKY_DEPTH));
}

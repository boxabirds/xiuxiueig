// Jelly asteroids. Each jelly is a star-shaped surface r(dir) given by 25 real
// spherical-harmonic coefficients fitted to its XPBD shell every frame (see
// jellies/body.js). Merging pairs blend with a growing smooth union.
// Look after Unix Jelly: studio lights to reflect, colour that deepens
// through thick jelly, inner glow where thin, a rim; layered looks colour the
// light inside, bit looks suspend opaque things in it.
in vec2 vUv;
uniform vec2 uResolution;
uniform vec2 uJitter;
uniform mat3 uCamBasis;
uniform vec3 uCamPos;
uniform float uTanHalfFov;
uniform highp sampler2D uJellies;  // one row per jelly, see renderer.js JELLY_TEXELS
uniform int uCount;
uniform float uTime;
out vec4 fragColor;

const float TAU = 6.2831853;
const float SKY_DEPTH = 10000.0;
const int MAX_CAND = 8;
const int MAX_LAYERS = 3;
const int OUTER_STEPS = 72;
const int INNER_STEPS = 40;
const float HIT_EPS = 0.003;
const float SDF_SCALE = 0.8;        // star-shaped distance overestimates; step conservatively
const float MIN_INNER_STEP = 0.02;
const float IOR = 1.4;              // Unix Jelly's jelly
const float F0 = 0.028;             // ((1.4-1)/(1.4+1))^2
const float CLEARCOAT = 1.0;
const float ATT_FRACTION = 0.6;     // attenuation distance as a fraction of radius
const float GLOW_THIN = 0.4;        // Unix Jelly: (thin * .4 + rim) * .15
const float GLOW_GAIN = 0.15;
const float RIM_POWER = 3.0;
const float RIM_GAIN = 0.5;
const float SCATTER_GAIN = 1.6;     // studio light scattered inside the jelly
const float FADE_START = 15.0;      // jellies dim into the dark beyond this
const float FADE_RATE = 0.18;
const float BLEND_WIDTH = 0.6;
const float FADE_IN_S = 2.5;        // new jellies fade in from nothing (owner request)

// ── studio rig (camera space; travels with the viewer) ──
// The key is a round softbox (a beauty dish). It was a four-pane window, after
// Unix Jelly, but its reflection read as the Windows logo on every jelly.
const vec3 KEY_DIR = vec3(-0.45, 0.55, -0.70);   // behind, above, left: reflects in faces turned to you
const vec3 KEY_COLOR = vec3(7.0, 6.7, 6.2);
const vec2 KEY_SIZE = vec2(0.42, 0.42);          // round: x is the radius
const vec3 FILL_DIR = vec3(0.85, 0.15, -0.50);
const vec3 FILL_COLOR = vec3(1.8, 2.3, 3.2);
const vec2 FILL_SIZE = vec2(0.3, 0.45);
const vec3 RIM_DIR_L = vec3(-0.92, 0.05, 0.38);  // thin strips ahead to the sides: grazing silhouettes
const vec3 RIM_DIR_R = vec3(0.92, 0.05, 0.38);
const vec3 RIM_COLOR = vec3(4.5, 4.4, 4.8);
const vec2 RIM_SIZE = vec2(0.04, 0.8);
const float ROUND_EDGE = 0.86;                    // inner radius fraction where the soft edge starts
const float STAR_SCALE = 260.0;
const float STAR_THRESHOLD = 0.9975;
const float STAR_GAIN = 0.55;

vec4 J(int j, int t) { return texelFetch(uJellies, ivec2(t, j), 0); }

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Real SH (l <= 4) radius: same constants as jellies/sh.js.
float shRadius(int j, vec3 d) {
  float x = d.x, y = d.y, z = d.z, x2 = x * x, y2 = y * y, z2 = z * z;
  vec4 c0 = J(j, 1), c1 = J(j, 2), c2 = J(j, 3), c3 = J(j, 4), c4 = J(j, 5), c5 = J(j, 6), c6 = J(j, 7);
  return c0.x * 0.282095
    + c0.y * 0.488603 * y + c0.z * 0.488603 * z + c0.w * 0.488603 * x
    + c1.x * 1.092548 * x * y + c1.y * 1.092548 * y * z + c1.z * 0.315392 * (3.0 * z2 - 1.0) + c1.w * 1.092548 * x * z
    + c2.x * 0.546274 * (x2 - y2) + c2.y * 0.590044 * y * (3.0 * x2 - y2) + c2.z * 2.890611 * x * y * z + c2.w * 0.457046 * y * (5.0 * z2 - 1.0)
    + c3.x * 0.373176 * z * (5.0 * z2 - 3.0) + c3.y * 0.457046 * x * (5.0 * z2 - 1.0) + c3.z * 1.445306 * z * (x2 - y2) + c3.w * 0.590044 * x * (x2 - 3.0 * y2)
    + c4.x * 2.503343 * x * y * (x2 - y2) + c4.y * 1.770131 * y * z * (3.0 * x2 - y2) + c4.z * 0.946175 * x * y * (7.0 * z2 - 1.0) + c4.w * 0.669047 * y * z * (7.0 * z2 - 3.0)
    + c5.x * 0.105786 * (35.0 * z2 * z2 - 30.0 * z2 + 3.0) + c5.y * 0.669047 * x * z * (7.0 * z2 - 3.0) + c5.z * 0.473087 * (x2 - y2) * (7.0 * z2 - 1.0) + c5.w * 1.770131 * x * z * (x2 - 3.0 * y2)
    + c6.x * 0.625836 * (x2 * (x2 - 3.0 * y2) - y2 * (3.0 * x2 - y2));
}

float jellyDist(vec3 p, int j) {
  vec4 c = J(j, 0);
  vec3 o = p - c.xyz;
  float l = length(o);
  if (l > c.w + 0.5) return l - c.w;          // outside the bound: cheap and safe
  return (l - shRadius(j, o / max(l, 1e-4))) * SDF_SCALE;
}

int cand[MAX_CAND];
int nCand;

/** Jellies whose bounds this ray can meet (beyond tStart); returns the far end of their span. */
float gather(vec3 ro, vec3 rd) {
  nCand = 0;
  float tEnd = -1.0;
  for (int j = 0; j < 32; j++) {
    if (j >= uCount) break;
    vec4 c = J(j, 0);
    float br = c.w + J(j, 13).w; // bound + blend radius
    vec3 oc = ro - c.xyz;
    float b = dot(oc, rd), cc = dot(oc, oc) - br * br, h = b * b - cc;
    if (h < 0.0) continue;
    float far = -b + sqrt(h);
    if (far < 0.0) continue;
    if (nCand < MAX_CAND) { cand[nCand] = j; nCand++; tEnd = max(tEnd, far); }
  }
  return tEnd;
}

float field(vec3 p) {
  float acc = 1e9, accK = 0.0;
  for (int i = 0; i < MAX_CAND; i++) {
    if (i >= nCand) break;
    int j = cand[i];
    float d = jellyDist(p, j);
    float k = J(j, 13).w;
    float prev = acc;
    acc = (k > 0.0 && accK > 0.0) ? smin(acc, d, max(k, accK)) : min(acc, d);
    if (d < prev) accK = k;
  }
  return acc;
}

vec3 fieldNormal(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.004;
  return normalize(e.xyy * field(p + e.xyy) + e.yyx * field(p + e.yyx) + e.yxy * field(p + e.yxy) + e.xxx * field(p + e.xxx));
}

/** The two nearest jellies and a soft weight between them (for merges). */
void nearestPair(vec3 p, out int ja, out int jb, out float wb) {
  float da = 1e9, db = 1e9; ja = -1; jb = -1;
  for (int i = 0; i < MAX_CAND; i++) {
    if (i >= nCand) break;
    int j = cand[i];
    float d = jellyDist(p, j);
    if (d < da) { db = da; jb = ja; da = d; ja = j; } else if (d < db) { db = d; jb = j; }
  }
  wb = (jb >= 0 && J(ja, 13).w > 0.0) ? clamp(0.5 - (db - da) / (2.0 * BLEND_WIDTH), 0.0, 0.5) : 0.0;
}

vec3 bodyCoords(int j, vec3 p) {
  vec3 o = p - J(j, 0).xyz;
  mat3 R = mat3(J(j, 8).xyz, J(j, 9).xyz, J(j, 10).xyz);
  return transpose(R) * o / J(j, 12).w;
}

vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }

// Look ids (renderer.js LOOK_IDS): 0 classic 1 zebra 2 spotty 3 stripy 4 swirly
// 5 sprinkle 6 checked 7 two-tone 8 glitter 9 rainbow 10 galaxy 11 golden
const vec3 INK = vec3(0.025, 0.012, 0.05);
const vec3 GALAXY_DEEP = vec3(0.06, 0.03, 0.22);
const vec3 AMBER_DEEP = vec3(1.0, 0.55, 0.05);

/** Attenuation colour at body coords q: layered looks colour the light inside. */
vec3 layered(int look, vec3 q, vec3 deep, vec3 deep2) {
  float on = 0.0; vec3 c2 = deep2;
  if (look == 1) { on = step(0.55, fract(q.x * 3.5 + sin(q.y * 6.0) * 0.3 + q.z * 1.5)); c2 = INK; }
  else if (look == 3) { on = step(0.5, fract((q.x + q.y) * 3.0)); }
  else if (look == 4) { on = step(0.5, fract(atan(q.y, q.x) / TAU * 2.0 + length(q.xy) * 4.0)); }
  else if (look == 6) { on = mod(floor(q.x * 3.0) + floor(q.y * 3.0) + floor(q.z * 3.0), 2.0); }
  else if (look == 7) { on = step(0.0, q.y + 0.25 * sin(q.x * 3.0)); }
  else if (look == 9) { return mix(vec3(0.15), hue(q.y * 0.5 + q.x * 0.2 + 0.5), 0.85); }
  else if (look == 10) { float sw = 0.5 + 0.5 * sin(atan(q.y, q.x) * 2.0 + length(q.xy) * 7.0); return mix(GALAXY_DEEP, deep, sw * 0.45); }
  else if (look == 11) { return AMBER_DEEP; }
  return mix(deep, c2, on);
}

// Bits suspended inside (look -> density per radius, presence, radius in cell units).
bool bitLook(int look, out float density, out float presence, out float radius) {
  density = 0.0; presence = 0.0; radius = 0.0;
  if (look == 2) { density = 2.6; presence = 0.4; radius = 0.2; }        // chocolate chips
  else if (look == 5) { density = 4.5; presence = 0.55; radius = 0.13; } // sprinkles
  else if (look == 8) { density = 8.0; presence = 0.3; radius = 0.11; }  // glitter
  else if (look == 10) { density = 7.0; presence = 0.3; radius = 0.06; } // galaxy stars
  else if (look == 11) { density = 2.2; presence = 0.55; radius = 0.24; }// gold leaf
  return density > 0.0;
}

vec3 keyDirWorld() { return normalize(uCamBasis * KEY_DIR); }

/** First suspended bit along body-space segment qa->qb (in cells); returns
 *  colour and the fraction along the segment (frac < 0: none). DDA over cells. */
vec3 findBit(int look, float seed, vec3 qa, vec3 qb, vec3 rdWorld, out float frac) {
  frac = -1.0;
  float density, presence, radius;
  if (!bitLook(look, density, presence, radius)) return vec3(0.0);
  vec3 a = qa * density, b = qb * density;
  vec3 d = b - a;
  float L = length(d);
  if (L < 1e-4) return vec3(0.0);
  d /= L;
  vec3 cell = floor(a);
  vec3 stp = vec3(d.x >= 0.0 ? 1.0 : -1.0, d.y >= 0.0 ? 1.0 : -1.0, d.z >= 0.0 ? 1.0 : -1.0);
  vec3 ad = max(abs(d), vec3(1e-5));
  vec3 tDelta = 1.0 / ad;
  vec3 tMax = (cell + max(stp, 0.0) - a) * stp / ad;
  for (int i = 0; i < 40; i++) {
    vec3 h = hash33(cell + seed * 17.0);
    if (h.x < presence && length(cell) < density * 1.2) {
      vec3 centre = cell + 0.5 + (h - 0.5) * 0.4;
      vec3 oc = a - centre;
      float bb = dot(oc, d), cc = dot(oc, oc) - radius * radius, disc = bb * bb - cc;
      if (disc > 0.0) {
        float t = -bb - sqrt(disc);
        if (t > 0.0 && t < L) {
          frac = t / L;
          float facet = hash13(cell * 1.7 + 3.1);
          if (look == 2) return vec3(0.09, 0.045, 0.02) * (0.6 + 0.8 * facet);
          if (look == 5) return hue(h.y) * 0.9 + 0.05;
          if (look == 8) { float glint = pow(facet, 12.0) * 9.0; return vec3(0.75, 0.78, 0.85) * (0.25 + glint); }
          if (look == 10) return vec3(2.4, 2.3, 1.8) * (0.5 + facet);
          if (look == 11) { float glint = pow(facet, 6.0) * 5.0; return vec3(1.0, 0.72, 0.25) * (0.5 + glint); }
        }
      }
    }
    float tNext = min(tMax.x, min(tMax.y, tMax.z));
    if (tNext > L) break;
    vec3 m = step(tMax.xyz, vec3(tNext + 1e-6));
    cell += m * stp;
    tMax += m * tDelta;
  }
  return vec3(0.0);
}

float softbox(vec3 dc, vec3 dir, vec2 size, bool round) {
  vec3 n = normalize(dir);
  float facing = dot(dc, n);
  if (facing <= 0.0) return 0.0;
  vec3 u = normalize(cross(vec3(0.0, 1.0, 0.0), n));
  vec3 v = cross(n, u);
  vec2 q = vec2(dot(dc, u), dot(dc, v)) / facing;
  if (round) return smoothstep(size.x, size.x * ROUND_EDGE, length(q));
  vec2 edge = smoothstep(size, size * 0.92, abs(q));
  return edge.x * edge.y;
}

vec3 stars(vec3 d) {
  vec3 g = d * STAR_SCALE;
  vec3 cell = floor(g);
  float h = hash13(cell);
  if (h < STAR_THRESHOLD) return vec3(0.0);
  vec3 c = cell + 0.5 + (hash33(cell) - 0.5) * 0.6;
  float s = smoothstep(0.35, 0.0, length(g - c));
  return vec3(0.85, 0.9, 1.0) * s * STAR_GAIN * (h - STAR_THRESHOLD) / (1.0 - STAR_THRESHOLD);
}

/** The studio as seen in direction d (world): black space, softboxes, stars. */
vec3 env(vec3 d, bool withStars) {
  vec3 dc = transpose(uCamBasis) * d;
  vec3 c = KEY_COLOR * softbox(dc, KEY_DIR, KEY_SIZE, true)
         + FILL_COLOR * softbox(dc, FILL_DIR, FILL_SIZE, false)
         + RIM_COLOR * (softbox(dc, RIM_DIR_L, RIM_SIZE, false) + softbox(dc, RIM_DIR_R, RIM_SIZE, false));
  return withStars ? c + stars(d) : c;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0 + uJitter * 2.0 / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec3 rd = normalize(uCamBasis * vec3(ndc.x * aspect * uTanHalfFov, ndc.y * uTanHalfFov, 1.0));
  vec3 ro = uCamPos;
  vec3 col = vec3(0.0), thr = vec3(1.0);
  float depth = SKY_DEPTH;
  float travelled = 0.0;
  vec3 keyW = keyDirWorld();
  vec3 fillW = normalize(uCamBasis * FILL_DIR);

  float tEnd = gather(ro, rd);
  bool inside = nCand > 0 && field(ro) < 0.0;   // flying through a jelly
  bool done = false;

  for (int layer = 0; layer < MAX_LAYERS; layer++) {
    vec3 p;
    vec3 n;
    float F = 0.0;
    float fade = 1.0;   // a fading-in jelly is partly see-through (no refraction, less colour)
    if (!inside) {
      if (nCand == 0) break;
      float t = 0.0;
      bool hit = false;
      for (int i = 0; i < OUTER_STEPS; i++) {
        float d = field(ro + rd * t);
        if (d < HIT_EPS) { hit = true; break; }
        t += max(d, HIT_EPS);
        if (t > tEnd) break;
      }
      if (!hit) break;
      p = ro + rd * t;
      // Dim into the dark with distance (only the part of this segment beyond FADE_START).
      float before = max(travelled - FADE_START, 0.0);
      travelled += t;
      thr *= exp(-(max(travelled - FADE_START, 0.0) - before) * FADE_RATE);
      if (layer == 0) depth = t;
      n = fieldNormal(p);
      F = F0 + (1.0 - F0) * pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 5.0);
      int jh, jh2; float wh;
      nearestPair(p, jh, jh2, wh);
      fade = jh >= 0 ? smoothstep(0.0, FADE_IN_S, J(jh, 14).y) : 1.0;
      // Clearcoat reflection of the studio: the round softbox highlight.
      col += thr * fade * F * CLEARCOAT * env(reflect(rd, n), false);
      vec3 straight = rd;
      rd = normalize(mix(straight, refract(straight, n, 1.0 / IOR), fade));
      ro = p + rd * HIT_EPS * 4.0;
    } else {
      p = ro;
      if (layer == 0) depth = 0.5;
    }
    inside = false;

    // Through the jelly.
    float len = HIT_EPS * 4.0;
    for (int i = 0; i < INNER_STEPS; i++) {
      float d = -field(ro + rd * len);
      if (d < HIT_EPS) break;
      len += max(d, MIN_INNER_STEP);
    }
    vec3 pe = ro + rd * len;
    vec3 mid = ro + rd * len * 0.5;
    int ja, jb; float wb;
    nearestPair(mid, ja, jb, wb);
    if (ja < 0) break;
    vec4 t11 = J(ja, 11), t12 = J(ja, 12), t13 = J(ja, 13), t14 = J(ja, 14);
    int look = int(t11.w + 0.5);
    vec3 q = bodyCoords(ja, mid);
    vec3 deep = layered(look, q, t12.rgb, t13.rgb);
    vec3 tint = t11.rgb;
    float radius = t12.w;
    if (jb >= 0 && wb > 0.0) {
      deep = mix(deep, layered(int(J(jb, 11).w + 0.5), bodyCoords(jb, mid), J(jb, 12).rgb, J(jb, 13).rgb), wb);
      tint = mix(tint, J(jb, 11).rgb, wb);
      radius = mix(radius, J(jb, 12).w, wb);
    }
    vec3 sigma = -log(max(deep, vec3(1e-3))) / (ATT_FRACTION * radius);

    // Suspended bits: an opaque thing inside ends the path through this jelly.
    float frac;
    vec3 bit = findBit(look, t14.x, bodyCoords(ja, ro), bodyCoords(ja, pe), rd, frac);
    float segment = frac >= 0.0 ? len * frac : len;
    vec3 trans = exp(-sigma * segment);

    // Studio light scattered inside (deepening with thickness), inner glow
    // where thin and a rim (Unix Jelly's emissive term).
    float lit = 0.35 + 0.65 * max(dot(n, keyW), 0.0) + 0.3 * max(dot(n, fillW), 0.0);
    vec3 scatter = tint * exp(-sigma * segment * 0.5) * (1.0 - exp(-segment / radius)) * lit * SCATTER_GAIN;
    float thin = clamp(1.0 - segment / (radius * 1.8), 0.15, 1.0);
    float rim = pow(1.0 - clamp(dot(n, -normalize(pe - uCamPos)), 0.0, 1.0), RIM_POWER) * RIM_GAIN;
    col += thr * fade * (1.0 - F) * (scatter + tint * (thin * GLOW_THIN + rim) * GLOW_GAIN * KEY_COLOR.x * 0.3);
    thr *= mix(vec3(1.0), (1.0 - F) * trans, fade);
    travelled += segment;

    if (frac >= 0.0 && fade > 0.999) {
      col += thr * bit;
      done = true;
      break;
    }
    if (frac >= 0.0) col += thr * bit * fade;

    vec3 ne = fieldNormal(pe);
    vec3 outDir = refract(rd, -ne, IOR);
    if (dot(outDir, outDir) < 0.5) outDir = reflect(rd, -ne);
    outDir = normalize(mix(rd, outDir, fade));
    rd = outDir;
    ro = pe + rd * HIT_EPS * 6.0;
    tEnd = gather(ro, rd);
  }
  if (!done) col += thr * env(rd, true);
  fragColor = vec4(col, min(depth, SKY_DEPTH));
}

// Geometric caustics, after Jelly Baby's method: a grid of parallel light rays
// is refracted through the jelly (Fresnel + Beer-Lambert). Connected ray
// triangles are rasterised where the rays land, and brightness is source area
// over landed area. One draw per colour channel, each with its own IOR: the
// misregistered plates.
in vec2 aGrid;
uniform vec2 uGridOrigin;
uniform float uGridExtent;
uniform vec2 uTileOrigin;
uniform float uTileExtent;
uniform vec3 uLightDir;
uniform float uIor;
uniform int uChannel;
out vec2 vOld;
out vec2 vNew;
out float vPower;

const int CAUSTIC_LAYERS = 2;
const int OUTER_STEPS = 44;
const int INNER_STEPS = 22;
const float START_ABOVE = 2.0;
const float MIN_DOWN = 0.05;
const float RAY_MAX = 40.0;

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
  vec2 target = uGridOrigin + aGrid * uGridExtent;
  float startY = BAND_TOP + START_ABOVE;
  vec3 ro = vec3(target.x, FLOOR_Y, target.y) - uLightDir * ((startY - FLOOR_Y) / -uLightDir.y);
  vec3 rd = uLightDir;
  float power = 1.0;

  for (int layer = 0; layer < CAUSTIC_LAYERS; layer++) {
    float tLimit = min(RAY_MAX, (ro.y - FLOOR_Y) / max(-rd.y, MIN_DOWN));
    float t = 0.0;
    bool hit = false;
    for (int i = 0; i < OUTER_STEPS; i++) {
      float d = field(ro + rd * t);
      if (d < HIT_EPS) { hit = true; break; }
      t += d * STEP_SCALE;
      if (t > tLimit) break;
      // Out of steps while still short of the floor: grazing a sheet. Count it
      // as a hit (as the scene march does) so neighbours agree.
      if (i == OUTER_STEPS - 1) hit = true;
    }
    if (!hit) break;
    vec3 p = ro + rd * t;
    vec3 n = fieldNormalFast(p);
    power *= 1.0 - schlick(dot(-rd, n));
    vec3 rIn = refract(rd, n, 1.0 / uIor);
    float len = marchIn(p, rIn);
    vec3 pe = p + rIn * len;
    vec3 sigma = absorptionAt(p + rIn * len * 0.5);
    power *= exp(-sigma[uChannel] * len);
    vec3 ne = fieldNormalFast(pe);
    vec3 rOut = refract(rIn, -ne, uIor);
    if (dot(rOut, rOut) < 0.5) { power = 0.0; break; } // trapped by TIR: no light
    power *= 1.0 - schlick(dot(rOut, ne));
    ro = pe + rOut * HIT_EPS * 8.0;
    rd = rOut;
  }
  if (rd.y > -MIN_DOWN) power = 0.0;
  vec3 land = ro + rd * ((ro.y - FLOOR_Y) / max(-rd.y, MIN_DOWN));

  vOld = target;
  vNew = land.xz;
  vPower = power;
  gl_Position = vec4((land.xz - uTileOrigin) / uTileExtent * 2.0 - 1.0, 0.0, 1.0);
}

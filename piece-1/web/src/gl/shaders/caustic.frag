in vec2 vOld;
in vec2 vNew;
in float vPower;
uniform vec3 uMask;
out vec4 fragColor;
const float CAUSTIC_MAX = 60.0; // matches Jelly Baby's half-float ceiling spirit
const float AREA_FLOOR = 1e-12;

float area(vec2 v) {
  vec2 dx = dFdx(v);
  vec2 dy = dFdy(v);
  return abs(dx.x * dy.y - dx.y * dy.x);
}

// Note: Jelly Baby also rejects triangles whose rays took different optical
// branches. That was tried here and removed: with a raymarched field the hit
// test is not reliable enough, and it discarded ~80% of the light (measured).
void main() {
  float density = area(vOld) / max(area(vNew), AREA_FLOOR);
  fragColor = vec4(uMask * min(density * vPower, CAUSTIC_MAX), 0.0);
}

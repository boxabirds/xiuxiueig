// Measures caustic convergence: the mean excess irradiance above the
// unfocused level (1.0) across the tile. Read back asynchronously so it can
// drive the glints. One output texel summarises one block of the tile.
in vec2 vUv;
uniform sampler2D uCaustic;
uniform vec2 uOutSize;
out vec4 fragColor;
const int TAPS = 8;
const float UNFOCUSED = 1.0;
const float RESPONSE = 0.8;

void main() {
  vec2 cell = floor(vUv * uOutSize);
  float excess = 0.0;
  for (int y = 0; y < TAPS; y++) {
    for (int x = 0; x < TAPS; x++) {
      vec2 uv = (cell + (vec2(x, y) + 0.5) / float(TAPS)) / uOutSize;
      vec3 irr = texture(uCaustic, uv).rgb;
      excess += max(dot(irr, vec3(1.0 / 3.0)) - UNFOCUSED, 0.0);
    }
  }
  excess /= float(TAPS * TAPS);
  fragColor = vec4(vec3(1.0 - exp(-excess * RESPONSE)), 1.0);
}

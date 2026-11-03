// HDR scene -> display-referred LDR (still at scene resolution), so FXAA can
// work on perceptual values. Saturation boost: "joyful, never murky".
in vec2 vUv;
uniform sampler2D uScene;
out vec4 fragColor;
const float EXPOSURE = 1.0;
// Jelly Baby's pre-grade: high contrast around linear 18% middle grey, with
// highlights left in HDR for the tone-mapping shoulder (owner: "high contrast").
const float MIDDLE_GREY = 0.18;
const float CONTRAST = 1.55;
const float SATURATION_LINEAR = 1.3; // before ACES, which desaturates highlights
const float SATURATION = 1.15;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 hdr = texture(uScene, vUv).rgb;
  hdr = max(mix(vec3(dot(hdr, LUMA)), hdr, SATURATION_LINEAR), 0.0);
  hdr = MIDDLE_GREY * pow(hdr / MIDDLE_GREY, vec3(CONTRAST));
  vec3 c = aces(hdr * EXPOSURE);
  c = mix(vec3(dot(c, LUMA)), c, SATURATION);
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  fragColor = vec4(c, 1.0);
}

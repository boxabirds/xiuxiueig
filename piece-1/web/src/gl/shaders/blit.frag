// Copies a texture; used with constant-alpha blending to fold each new caustic
// frame into a smoothed history (caustic folds glide instead of twitching).
in vec2 vUv;
uniform sampler2D uSource;
out vec4 fragColor;
void main() {
  fragColor = texture(uSource, vUv);
}

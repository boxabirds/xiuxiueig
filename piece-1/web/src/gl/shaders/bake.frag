// Bakes fieldValueAnalytic into one z-layer of the 3D volume around the viewer.
in vec2 vUv;
uniform float uLayerY;   // world y of this layer voxel centres
uniform vec3 uBakeOrigin;
uniform vec3 uBakeExtent;
out vec4 fragColor;
void main() {
  // Note: this program is compiled without USE_VOLUME.
  vec2 xz = uBakeOrigin.xz + vUv * uBakeExtent.xz;
  fragColor = vec4(fieldValueAnalytic(vec3(xz.x, uLayerY, xz.y)), 0.0, 0.0, 1.0);
}

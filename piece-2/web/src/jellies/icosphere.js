// Unit icosphere: vertices, triangles and unique edges. Subdivision 2 gives
// 162 vertices (the jelly shell's particles) that are near-uniform on the sphere.
const PHI = (1 + Math.sqrt(5)) / 2;

export function icosphere(subdivisions) {
  const v = [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
  ].map(normalize);
  let f = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdivisions; s++) {
    const mid = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!mid.has(key)) {
        v.push(normalize([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]));
        mid.set(key, v.length - 1);
      }
      return mid.get(key);
    };
    f = f.flatMap(([a, b, c]) => {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  const edgeSet = new Set();
  const edges = [];
  for (const [a, b, c] of f) {
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      if (!edgeSet.has(key)) { edgeSet.add(key); edges.push([Math.min(i, j), Math.max(i, j)]); }
    }
  }
  return { vertices: v, triangles: f, edges };
}

function normalize([x, y, z]) {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Solid angle each vertex represents (a third of each adjacent triangle's),
 *  normalised to sum to 4*pi: quadrature weights for fitting on the sphere. */
export function vertexSolidAngles(vertices, triangles) {
  const w = new Float64Array(vertices.length);
  for (const [a, b, c] of triangles) {
    const A = vertices[a], B = vertices[b], C = vertices[c];
    // Van Oosterom & Strackee solid angle of a spherical triangle.
    const det = A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0]);
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const omega = 2 * Math.atan2(Math.abs(det), 1 + dot(A, B) + dot(B, C) + dot(C, A));
    w[a] += omega / 3; w[b] += omega / 3; w[c] += omega / 3;
  }
  const total = w.reduce((s, x) => s + x, 0);
  const FOUR_PI = 4 * Math.PI;
  for (let i = 0; i < w.length; i++) w[i] *= FOUR_PI / total;
  return w;
}

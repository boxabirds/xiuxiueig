import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icosphere, vertexSolidAngles } from '../web/src/jellies/icosphere.js';
import { SH_COUNT, shBasis, shFit, shRadius } from '../web/src/jellies/sh.js';

const ico = icosphere(2);
const w = vertexSolidAngles(ico.vertices, ico.triangles);
const dirs = Float64Array.from(ico.vertices.flat());

test('icosphere subdivision 2 has 162 vertices, 320 triangles, 480 edges', () => {
  assert.equal(ico.vertices.length, 162);
  assert.equal(ico.triangles.length, 320);
  assert.equal(ico.edges.length, 480);
});

test('basis is orthonormal under the icosphere quadrature', () => {
  const G = Array.from({ length: SH_COUNT }, () => new Float64Array(SH_COUNT));
  const y = new Float64Array(SH_COUNT);
  for (let i = 0; i < ico.vertices.length; i++) {
    shBasis(...ico.vertices[i], y);
    for (let a = 0; a < SH_COUNT; a++) for (let b = 0; b < SH_COUNT; b++) G[a][b] += w[i] * y[a] * y[b];
  }
  for (let a = 0; a < SH_COUNT; a++) {
    for (let b = 0; b < SH_COUNT; b++) {
      const want = a === b ? 1 : 0;
      assert.ok(Math.abs(G[a][b] - want) < 0.03, `G[${a}][${b}] = ${G[a][b]}`);
    }
  }
});

test('a sphere of radius R fits to R everywhere', () => {
  const R = 2.5;
  const c = shFit(dirs, new Float64Array(162).fill(R), w, new Float64Array(SH_COUNT));
  for (const d of [[1, 0, 0], [0, 1, 0], [0.3, -0.5, 0.8], [-1, -1, -1]]) {
    assert.ok(Math.abs(shRadius(c, ...d) - R) < 1e-3, `r(${d}) = ${shRadius(c, ...d)}`);
  }
});

test('a smooth blob (band-limited) is reproduced within 2%', () => {
  const truth = new Float64Array(SH_COUNT);
  truth[0] = 2 / 0.282095; truth[6] = 0.3; truth[13] = -0.2; truth[20] = 0.15; truth[16] = 0.1;
  const radii = Float64Array.from(ico.vertices, (d) => shRadius(truth, ...d));
  const c = shFit(dirs, radii, w, new Float64Array(SH_COUNT));
  for (let i = 0; i < 200; i++) {
    const d = [Math.sin(i * 1.3), Math.cos(i * 0.7), Math.sin(i * 2.1 + 1)];
    const rt = shRadius(truth, ...d), rf = shRadius(c, ...d);
    assert.ok(Math.abs(rf - rt) / rt < 0.02, `dir ${i}: ${rf} vs ${rt}`);
  }
});

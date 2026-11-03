// WebGL2 renderer for piece 2: raymarched jellies -> TAA -> Neutral tone map ->
// FXAA + upscale. Jelly state goes to the GPU as one RGBA32F row per jelly.
import { LOOKS } from '../jellies/field.js';
import { jellyColors } from '../colors.js';

const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
const MODULE_URL = import.meta.url;
const shaderUrl = (name) => new URL(`shaders/${name}`, MODULE_URL);

export const MAX_JELLIES = 32;
const JELLY_TEXELS = 16; // see scene.frag J(j, t)
const FOV_Y_RAD = (60 * Math.PI) / 180;
const JITTER_SAMPLES = 8;
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const JITTER = Array.from({ length: JITTER_SAMPLES }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);
const LOOK_IDS = Object.fromEntries(LOOKS.map((l, i) => [l, i]));
const BLEND_RADIUS = 0.9; // x smaller radius at full blend

async function loadSources(names) {
  const entries = await Promise.all(names.map(async (n) => {
    const r = await fetch(shaderUrl(n));
    if (!r.ok) throw new Error(`shader ${n}: ${r.status}`);
    if ((r.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`shader ${n}: got HTML (bad path)`);
    return [n, (await r.text()).replace(/[^\x00-\x7f]/g, '')];
  }));
  return Object.fromEntries(entries);
}

function compile(gl, type, source, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${label}: ${gl.getShaderInfoLog(s)}`);
  return s;
}

function program(gl, vs, fs, label) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, `${label}.vert`));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, `${label}.frag`));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${label}: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

function target(gl, w, h, internal, format, type) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
  return { tex, fbo, width: w, height: h };
}

export class Renderer {
  static async create(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is required.');
    const src = await loadSources(['fullscreen.vert', 'scene.frag', 'taa.frag', 'tonemap.frag', 'present.frag']);
    return new Renderer(canvas, gl, src);
  }

  constructor(canvas, gl, src) {
    this.canvas = canvas;
    this.gl = gl;
    const vs = HEADER + src['fullscreen.vert'];
    this.scene = program(gl, vs, HEADER + src['scene.frag'], 'scene');
    this.taa = program(gl, vs, HEADER + src['taa.frag'], 'taa');
    this.tonemap = program(gl, vs, HEADER + src['tonemap.frag'], 'tonemap');
    this.present = program(gl, vs, HEADER + src['present.frag'], 'present');
    this.vao = gl.createVertexArray();
    this.jellyData = new Float32Array(MAX_JELLIES * JELLY_TEXELS * 4);
    this.jellyTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.jellyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, JELLY_TEXELS, MAX_JELLIES, 0, gl.RGBA, gl.FLOAT, null);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    this.colorCache = new Map();
    this.renderScale = 0.5;
    this.sceneTarget = null; this.ldrTarget = null; this.taaTargets = [null, null];
    this.taaIndex = 0; this.historyValid = false;
    this.basis = new Float32Array(9); this.prevBasis = new Float32Array(9);
    this.camPos = new Float32Array(3); this.prevPos = new Float32Array(3); this.camDelta = new Float32Array(3);
    this.frame = 0;
    this.count = 0;
  }

  resize(cssW, cssH, dpr) {
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.ensureTargets();
  }

  setRenderScale(s) { this.renderScale = s; this.ensureTargets(); }

  ensureTargets() {
    const gl = this.gl;
    const w = Math.max(1, Math.round(this.canvas.width * this.renderScale)), h = Math.max(1, Math.round(this.canvas.height * this.renderScale));
    if (this.sceneTarget && this.sceneTarget.width === w && this.sceneTarget.height === h) return;
    for (const t of [this.sceneTarget, this.ldrTarget, ...this.taaTargets]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    this.sceneTarget = target(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    this.ldrTarget = target(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.taaTargets = [0, 1].map(() => target(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT));
    this.historyValid = false;
  }

  colors(hex) {
    if (!this.colorCache.has(hex)) this.colorCache.set(hex, jellyColors(hex));
    return this.colorCache.get(hex);
  }

  /** Pack the field's jellies into the data texture. */
  upload(field) {
    const d = this.jellyData;
    const bodies = field.bodies;
    const n = Math.min(bodies.length, MAX_JELLIES);
    for (let j = 0; j < n; j++) {
      const b = bodies[j], o = j * JELLY_TEXELS * 4;
      d[o] = b.center[0]; d[o + 1] = b.center[1]; d[o + 2] = b.center[2]; d[o + 3] = b.boundRadius;
      for (let k = 0; k < 28; k++) d[o + 4 + k] = k < 25 ? b.coeffs[k] : 0;
      const R = b.rotation;
      for (let c = 0; c < 3; c++) { d[o + 32 + c * 4] = R[c * 3]; d[o + 33 + c * 4] = R[c * 3 + 1]; d[o + 34 + c * 4] = R[c * 3 + 2]; d[o + 35 + c * 4] = 0; }
      const c1 = this.colors(b.color), c2 = this.colors(b.color2);
      d[o + 44] = c1.tint[0]; d[o + 45] = c1.tint[1]; d[o + 46] = c1.tint[2]; d[o + 47] = LOOK_IDS[b.look];
      d[o + 48] = c1.deep[0]; d[o + 49] = c1.deep[1]; d[o + 50] = c1.deep[2]; d[o + 51] = b.radius;
      const k = b.merge ? b.merge.s * BLEND_RADIUS * Math.min(b.radius, b.merge.other.radius) : 0;
      d[o + 52] = c2.deep[0]; d[o + 53] = c2.deep[1]; d[o + 54] = c2.deep[2]; d[o + 55] = k;
      d[o + 56] = b.seed; d[o + 57] = b.age; d[o + 58] = 0; d[o + 59] = 0;
    }
    this.count = n;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.jellyTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, JELLY_TEXELS, MAX_JELLIES, gl.RGBA, gl.FLOAT, d);
  }

  /** Floating origin: keep TAA reprojection continuous. */
  rebase(offset) { for (let k = 0; k < 3; k++) this.prevPos[k] -= offset[k]; }

  render(field, viewer, fade, time) {
    const gl = this.gl;
    this.upload(field);
    this.camPos.set(viewer.position);
    viewer.basis(this.basis);
    const st = this.sceneTarget;
    gl.bindVertexArray(this.vao);

    // 1. Scene.
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo);
    gl.viewport(0, 0, st.width, st.height);
    const s = this.scene;
    gl.useProgram(s.p);
    gl.uniform2f(s.u.uResolution, st.width, st.height);
    const j = JITTER[this.frame % JITTER_SAMPLES];
    gl.uniform2f(s.u.uJitter, j[0], j[1]);
    gl.uniformMatrix3fv(s.u.uCamBasis, false, this.basis);
    gl.uniform3fv(s.u.uCamPos, this.camPos);
    gl.uniform1f(s.u.uTanHalfFov, Math.tan(FOV_Y_RAD / 2));
    gl.uniform1i(s.u.uCount, this.count);
    gl.uniform1f(s.u.uTime, time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.jellyTex);
    gl.uniform1i(s.u.uJellies, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. TAA.
    const out = this.taaTargets[this.taaIndex], hist = this.taaTargets[1 - this.taaIndex];
    for (let k = 0; k < 3; k++) this.camDelta[k] = this.historyValid ? this.camPos[k] - this.prevPos[k] : 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    const t = this.taa;
    gl.useProgram(t.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st.tex); gl.uniform1i(t.u.uCurrent, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, hist.tex); gl.uniform1i(t.u.uHistory, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(t.u.uTexel, 1 / st.width, 1 / st.height);
    gl.uniformMatrix3fv(t.u.uBasis, false, this.basis);
    gl.uniformMatrix3fv(t.u.uPrevBasis, false, this.historyValid ? this.prevBasis : this.basis);
    gl.uniform3fv(t.u.uCamDelta, this.camDelta);
    gl.uniform1f(t.u.uTanHalfFov, Math.tan(FOV_Y_RAD / 2));
    gl.uniform1f(t.u.uAspect, st.width / st.height);
    gl.uniform1f(t.u.uHistoryValid, this.historyValid ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.prevBasis.set(this.basis); this.prevPos.set(this.camPos); this.historyValid = true;
    this.taaIndex = 1 - this.taaIndex;

    // 3. Tone map.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ldrTarget.fbo);
    gl.useProgram(this.tonemap.p);
    gl.bindTexture(gl.TEXTURE_2D, out.tex);
    gl.uniform1i(this.tonemap.u.uScene, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 4. FXAA + upscale + finish.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const p = this.present;
    gl.useProgram(p.p);
    gl.bindTexture(gl.TEXTURE_2D, this.ldrTarget.tex);
    gl.uniform1i(p.u.uImage, 0);
    gl.uniform2f(p.u.uTexel, 1 / st.width, 1 / st.height);
    gl.uniform1f(p.u.uFade, fade);
    gl.uniform1f(p.u.uGrainSeed, (this.frame % 255) * 0.618);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.frame++;
  }
}

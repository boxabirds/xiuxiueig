// WebGL2 renderer: caustics → convergence readback → raymarched scene →
// present. The scene runs at an adaptive internal resolution.
import { BAND_BOTTOM, BAND_TOP, WORLD_PERIOD, glslDefines } from '../world.js';

// Resolve each shader against this module. (A literal `new URL('./shaders/',
// import.meta.url)` is rewritten by Vite without its trailing slash.)
const MODULE_URL = import.meta.url;
const shaderUrl = (name) => new URL(`shaders/${name}`, MODULE_URL);
const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\n';

const CAUSTIC_RES = 512;
// Baked field volume around the viewer (see field.glsl, USE_VOLUME).
const VOLUME_RES_XZ = 256;
const VOLUME_LAYERS = 48;
const VOXEL_XZ = 0.33;                       // world units; ~38 voxels per fine cell
const VOLUME_Y_MARGIN = 4.0;                 // >= field.glsl BAND_SKIP (3.9)
const VOLUME_Y0 = BAND_BOTTOM - VOLUME_Y_MARGIN;
const VOLUME_EXTENT = [VOLUME_RES_XZ * VOXEL_XZ, BAND_TOP - BAND_BOTTOM + 2 * VOLUME_Y_MARGIN, VOLUME_RES_XZ * VOXEL_XZ];
const VOLUME_UNIT = 1;
const CAUSTIC_TILE_EXTENT = 44;   // world units around the viewer
const CAUSTIC_GRID = 120;         // rays per side (256 removed beading but cost half the resolution)
const CAUSTIC_INTERVAL_FRAMES = 3; // the field evolves slowly and caustics are temporally smoothed
// Fraction of each new caustic frame blended into the history (~0.2 s time
// constant at 30 Hz updates). Caustic folds move fast for tiny shape changes;
// unsmoothed they read as twitchy sparkle (owner feedback, measured shimmer).
const CAUSTIC_BLEND = 0.22;
// TAA jitter: Halton(2,3), 8 samples per cycle, in pixels around the centre.
const JITTER_SAMPLES = 8;
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const JITTER = Array.from({ length: JITTER_SAMPLES }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);
const CAUSTIC_GRID_MARGIN = 0.18; // rays beyond the tile so edges get light
const REDUCE_RES = 8;
const READBACK_INTERVAL_FRAMES = 6;
const LIGHT_TILT = 0.26; // horizontal component of the light; azimuth wanders with the era
const FOV_Y_RAD = (62 * Math.PI) / 180;
const CHANNEL_MASKS = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const BYTE_MAX = 255;

async function loadSources(names) {
  const entries = await Promise.all(
    names.map(async (n) => {
      const r = await fetch(shaderUrl(n));
      if (!r.ok) throw new Error(`shader ${n}: ${r.status}`);
      if ((r.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`shader ${n}: got HTML (bad path)`);
      // GLSL ES accepts ASCII only (even in comments); strip anything else.
      return [n, (await r.text()).replace(/[^\x00-\x7f]/g, '')];
    }),
  );
  return Object.fromEntries(entries);
}

function compile(gl, type, source, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`${label}: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

function program(gl, vs, fs, label) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, `${label}.vert`));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, `${label}.frag`));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${label}: ${gl.getProgramInfoLog(p)}`);
  const uniforms = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

function target(gl, width, height, internalFormat, format, type, filter) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
  return { tex, fbo, width, height };
}

export class Renderer {
  static async create(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is required.');
    const src = await loadSources(['field.glsl', 'fullscreen.vert', 'caustic.vert', 'caustic.frag', 'reduce.frag', 'scene.frag', 'tonemap.frag', 'present.frag', 'bake.frag', 'blit.frag', 'taa.frag']);
    return new Renderer(canvas, gl, src);
  }

  constructor(canvas, gl, src) {
    this.canvas = canvas;
    this.gl = gl;
    const analytic = HEADER + glslDefines() + '\n' + src['field.glsl'] + '\n';
    const shared = HEADER + glslDefines() + '\n#define USE_VOLUME\n' + src['field.glsl'] + '\n';
    const plain = HEADER + glslDefines() + '\n';
    this.bake = program(gl, plain + src['fullscreen.vert'], analytic + src['bake.frag'], 'bake');
    this.caustic = program(gl, shared + src['caustic.vert'], plain + src['caustic.frag'], 'caustic');
    this.reduce = program(gl, plain + src['fullscreen.vert'], plain + src['reduce.frag'], 'reduce');
    this.scene = program(gl, plain + src['fullscreen.vert'], shared + src['scene.frag'], 'scene');
    this.taa = program(gl, plain + src['fullscreen.vert'], plain + src['taa.frag'], 'taa');
    this.blit = program(gl, plain + src['fullscreen.vert'], plain + src['blit.frag'], 'blit');
    this.tonemap = program(gl, plain + src['fullscreen.vert'], plain + src['tonemap.frag'], 'tonemap');
    this.present = program(gl, plain + src['fullscreen.vert'], plain + src['present.frag'], 'present');

    this.emptyVao = gl.createVertexArray();
    this.volume = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this.volume);
    // width = x, height = z, depth = y: each depth layer is one horizontal slice.
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, VOLUME_RES_XZ, VOLUME_RES_XZ, VOLUME_LAYERS, 0, gl.RED, gl.HALF_FLOAT, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) {
      gl.texParameteri(gl.TEXTURE_3D, k, v);
    }
    this.volumeFbo = gl.createFramebuffer();
    this.volOrigin = new Float32Array(3);
    this.volExtent = new Float32Array(VOLUME_EXTENT);
    this.buildGrid();
    this.causticTarget = target(gl, CAUSTIC_RES, CAUSTIC_RES, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    // Smoothed history, mipmapped: the distant floor averages caustics instead
    // of shimmering, and folds glide instead of jumping.
    this.causticHistory = target(gl, CAUSTIC_RES, CAUSTIC_RES, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, this.causticHistory.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.historyPrimed = false;
    this.reduceTarget = target(gl, REDUCE_RES, REDUCE_RES, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.sceneTarget = null;
    this.ldrTarget = null;
    this.taaTargets = [null, null];
    this.taaIndex = 0;
    this.historyValid = false;
    this.prevBasis = new Float32Array(9);
    this.prevPos = new Float32Array(3);
    this.camDelta = new Float32Array(3);
    this.lightDir = new Float32Array([0, -1, 0]);
    this.renderScale = 0.6;
    this.basis = new Float32Array(9);
    this.tileOrigin = new Float32Array(2);
    this.gridOrigin = new Float32Array(2);
    this.camPos = new Float32Array(3);

    this.readback = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.readback);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, REDUCE_RES * REDUCE_RES * 4, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.readbackBytes = new Uint8Array(REDUCE_RES * REDUCE_RES * 4);
    this.fence = null;
    this.frame = 0;
    this.convergence = 0;
  }

  buildGrid() {
    const gl = this.gl;
    const n = CAUSTIC_GRID;
    const verts = new Float32Array(n * n * 2);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        verts[(y * n + x) * 2] = x / (n - 1);
        verts[(y * n + x) * 2 + 1] = y / (n - 1);
      }
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const a = y * n + x, b = a + 1, c = a + n, d = c + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = c;
        idx[k++] = b; idx[k++] = d; idx[k++] = c;
      }
    }
    this.gridCount = idx.length;
    this.gridVao = gl.createVertexArray();
    gl.bindVertexArray(this.gridVao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.caustic.p, 'aGrid');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  /** Resize canvas to CSS size × dpr; internal scene target at renderScale. */
  resize(cssWidth, cssHeight, dpr) {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ensureSceneTarget();
  }

  setRenderScale(scale) {
    this.renderScale = scale;
    this.ensureSceneTarget();
  }

  ensureSceneTarget() {
    const gl = this.gl;
    const w = Math.max(1, Math.round(this.canvas.width * this.renderScale));
    const h = Math.max(1, Math.round(this.canvas.height * this.renderScale));
    if (this.sceneTarget && this.sceneTarget.width === w && this.sceneTarget.height === h) return;
    for (const t of [this.sceneTarget, this.ldrTarget, ...this.taaTargets]) {
      if (!t) continue;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    this.sceneTarget = target(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.ldrTarget = target(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    this.taaTargets = [0, 1].map(() => target(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR));
    this.historyValid = false;
  }

  setFieldUniforms(u, score, viewer) {
    const gl = this.gl;
    gl.uniform3fv(u.uWarp, score.warp);
    gl.uniform3fv(u.uWobble, score.wobble);
    gl.uniform1f(u.uBreath, score.breath);
    gl.uniform1f(u.uChaos, score.chaos);
    gl.uniform3fv(u.uCamPos, this.camPos);
    gl.uniform1f(u.uFlavorPhase, score.flavorPhase);
    gl.uniform1f(u.uFlavorAngle, score.flavorAngle);
    const e = score.era;
    gl.uniform3fv(u.uFamily, e.family);
    gl.uniform1f(u.uEraScale, e.scale);
    gl.uniform1f(u.uEraTurbulence, e.turbulence);
    gl.uniform1f(u.uEraThickness, e.thickness);
    gl.uniform1f(u.uEraSaturation, e.saturation);
    gl.uniform1f(u.uEraDrift, e.drift);
    if (u.uVolume) {
      gl.activeTexture(gl.TEXTURE0 + VOLUME_UNIT);
      gl.bindTexture(gl.TEXTURE_3D, this.volume);
      gl.uniform1i(u.uVolume, VOLUME_UNIT);
      gl.uniform3fv(u.uVolOrigin, this.volOrigin);
      gl.uniform3fv(u.uVolExtent, this.volExtent);
      gl.activeTexture(gl.TEXTURE0);
    }
  }

  /** Bake the slow, smooth part of the field around the viewer, one layer per draw.
   *  Texture axes: s = x, t = z, r (layer) = y. */
  bakeVolume(score, viewer) {
    const gl = this.gl;
    this.volOrigin[0] = Math.floor((viewer.position[0] - VOLUME_EXTENT[0] / 2) / VOXEL_XZ) * VOXEL_XZ;
    this.volOrigin[1] = VOLUME_Y0;
    this.volOrigin[2] = Math.floor((viewer.position[2] - VOLUME_EXTENT[2] / 2) / VOXEL_XZ) * VOXEL_XZ;
    const b = this.bake;
    gl.useProgram(b.p);
    this.setFieldUniforms(b.u, score, viewer);
    gl.uniform3fv(b.u.uBakeOrigin, this.volOrigin);
    gl.uniform3fv(b.u.uBakeExtent, this.volExtent);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.volumeFbo);
    gl.viewport(0, 0, VOLUME_RES_XZ, VOLUME_RES_XZ);
    gl.bindVertexArray(this.emptyVao);
    const voxelY = VOLUME_EXTENT[1] / VOLUME_LAYERS;
    for (let layer = 0; layer < VOLUME_LAYERS; layer++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.volume, 0, layer);
      gl.uniform1f(b.u.uLayerY, VOLUME_Y0 + (layer + 0.5) * voxelY);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  render(score, viewer) {
    const gl = this.gl;
    this.camPos.set(viewer.position);
    const az = score.era.lightAzimuth;
    const l = Math.hypot(LIGHT_TILT, 1);
    this.lightDir[0] = (Math.cos(az) * LIGHT_TILT) / l;
    this.lightDir[1] = -1 / l;
    this.lightDir[2] = (Math.sin(az) * LIGHT_TILT) / l;
    this.bakeVolume(score, viewer);
    if (this.frame % CAUSTIC_INTERVAL_FRAMES === 0) this.renderCaustics(score, viewer);
    this.renderScene(score, viewer);
    this.frame++;
  }

  renderCaustics(score, viewer) {
    const gl = this.gl;
    const texel = CAUSTIC_TILE_EXTENT / CAUSTIC_RES;
    // Snap the tile to whole texels so the caustics do not shimmer as we drift.
    this.tileOrigin[0] = Math.floor((viewer.position[0] - CAUSTIC_TILE_EXTENT / 2) / texel) * texel;
    this.tileOrigin[1] = Math.floor((viewer.position[2] - CAUSTIC_TILE_EXTENT / 2) / texel) * texel;
    const gridExtent = CAUSTIC_TILE_EXTENT * (1 + 2 * CAUSTIC_GRID_MARGIN);
    this.gridOrigin[0] = this.tileOrigin[0] - CAUSTIC_TILE_EXTENT * CAUSTIC_GRID_MARGIN;
    this.gridOrigin[1] = this.tileOrigin[1] - CAUSTIC_TILE_EXTENT * CAUSTIC_GRID_MARGIN;

    // 1. Caustics: three channel passes, additive.
    const c = this.caustic;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.causticTarget.fbo);
    gl.viewport(0, 0, CAUSTIC_RES, CAUSTIC_RES);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(c.p);
    this.setFieldUniforms(c.u, score, viewer);
    gl.uniform2fv(c.u.uGridOrigin, this.gridOrigin);
    gl.uniform1f(c.u.uGridExtent, gridExtent);
    gl.uniform2fv(c.u.uTileOrigin, this.tileOrigin);
    gl.uniform1f(c.u.uTileExtent, CAUSTIC_TILE_EXTENT);
    gl.uniform3fv(c.u.uLightDir, this.lightDir);
    gl.bindVertexArray(this.gridVao);
    for (let ch = 0; ch < 3; ch++) {
      gl.uniform1f(c.u.uIor, score.ior[ch]);
      gl.uniform1i(c.u.uChannel, ch);
      gl.uniform3fv(c.u.uMask, CHANNEL_MASKS[ch]);
      gl.drawElements(gl.TRIANGLES, this.gridCount, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(this.emptyVao);
    // Fold the new frame into the history: h = h*(1-a) + new*a (first frame: copy).
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.causticHistory.fbo);
    gl.useProgram(this.blit.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.causticTarget.tex);
    gl.uniform1i(this.blit.u.uSource, 0);
    const a = this.historyPrimed ? CAUSTIC_BLEND : 1;
    gl.blendColor(0, 0, 0, a);
    gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    this.historyPrimed = true;
    gl.bindTexture(gl.TEXTURE_2D, this.causticHistory.tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    // 2. Convergence: reduce and read back asynchronously.
    this.pollReadback();
    if (!this.fence && this.frame % READBACK_INTERVAL_FRAMES === 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.reduceTarget.fbo);
      gl.viewport(0, 0, REDUCE_RES, REDUCE_RES);
      gl.useProgram(this.reduce.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.causticTarget.tex);
      gl.uniform1i(this.reduce.u.uCaustic, 0);
      gl.uniform2f(this.reduce.u.uOutSize, REDUCE_RES, REDUCE_RES);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.readback);
      gl.readPixels(0, 0, REDUCE_RES, REDUCE_RES, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    }

  }

  renderScene(score, viewer) {
    const gl = this.gl;
    const s = this.scene;
    const st = this.sceneTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo);
    gl.viewport(0, 0, st.width, st.height);
    gl.useProgram(s.p);
    this.setFieldUniforms(s.u, score, viewer);
    gl.uniform2f(s.u.uResolution, st.width, st.height);
    gl.uniformMatrix3fv(s.u.uCamBasis, false, viewer.basis(this.basis));
    const j = JITTER[this.frame % JITTER_SAMPLES];
    gl.uniform2f(s.u.uJitter, j[0], j[1]);
    gl.uniform1f(s.u.uTanHalfFov, Math.tan(FOV_Y_RAD / 2));
    gl.uniform3fv(s.u.uIor, score.ior);
    gl.uniform3fv(s.u.uSky0, score.sky[0]);
    gl.uniform3fv(s.u.uSky1, score.sky[1]);
    gl.uniform3fv(s.u.uSky2, score.sky[2]);
    gl.uniform1f(s.u.uSkyPhase, score.skyPhase);
    gl.uniform1f(s.u.uAltitude, score.altitude);
    gl.uniform1f(s.u.uGlow, score.glow);
    gl.uniform1f(s.u.uSparkle, score.sparkle);
    gl.uniform2fv(s.u.uTileOrigin, this.tileOrigin);
    gl.uniform1f(s.u.uTileExtent, CAUSTIC_TILE_EXTENT);
    gl.uniform3fv(s.u.uLightDir, this.lightDir);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.causticHistory.tex);
    gl.uniform1i(s.u.uCaustic, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 4. TAA: reproject and accumulate.
    const taaOut = this.taaTargets[this.taaIndex];
    const taaHist = this.taaTargets[1 - this.taaIndex];
    for (let i = 0; i < 3; i++) {
      let d = this.camPos[i] - this.prevPos[i];
      if (i !== 1) d -= Math.round(d / WORLD_PERIOD) * WORLD_PERIOD; // world wrap
      this.camDelta[i] = this.historyValid ? d : 0;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, taaOut.fbo);
    gl.useProgram(this.taa.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st.tex);
    gl.uniform1i(this.taa.u.uCurrent, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, taaHist.tex);
    gl.uniform1i(this.taa.u.uHistory, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(this.taa.u.uTexel, 1 / st.width, 1 / st.height);
    gl.uniformMatrix3fv(this.taa.u.uBasis, false, this.basis);
    gl.uniformMatrix3fv(this.taa.u.uPrevBasis, false, this.historyValid ? this.prevBasis : this.basis);
    gl.uniform3fv(this.taa.u.uCamDelta, this.camDelta);
    gl.uniform1f(this.taa.u.uTanHalfFov, Math.tan(FOV_Y_RAD / 2));
    gl.uniform1f(this.taa.u.uAspect, st.width / st.height);
    gl.uniform1f(this.taa.u.uHistoryValid, this.historyValid ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.prevBasis.set(this.basis);
    this.prevPos.set(this.camPos);
    this.historyValid = true;
    this.taaIndex = 1 - this.taaIndex;

    // 5. Tone map at scene resolution.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ldrTarget.fbo);
    gl.useProgram(this.tonemap.p);
    gl.bindTexture(gl.TEXTURE_2D, taaOut.tex);
    gl.uniform1i(this.tonemap.u.uScene, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 6. FXAA + upscale + finish.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.present.p);
    gl.bindTexture(gl.TEXTURE_2D, this.ldrTarget.tex);
    gl.uniform1i(this.present.u.uImage, 0);
    gl.uniform2f(this.present.u.uTexel, 1 / st.width, 1 / st.height);
    gl.uniform1f(this.present.u.uFade, score.fade);
    gl.uniform1f(this.present.u.uGrainSeed, (this.frame % BYTE_MAX) * 0.618);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  pollReadback() {
    const gl = this.gl;
    if (!this.fence) return;
    if (gl.getSyncParameter(this.fence, gl.SYNC_STATUS) !== gl.SIGNALED) return;
    gl.deleteSync(this.fence);
    this.fence = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.readback);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.readbackBytes);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    let sum = 0;
    for (let i = 0; i < this.readbackBytes.length; i += 4) sum += this.readbackBytes[i];
    this.convergence = sum / (BYTE_MAX * REDUCE_RES * REDUCE_RES);
  }
}

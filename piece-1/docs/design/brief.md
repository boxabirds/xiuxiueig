# Brief: *xiuxiueig*

The collective vision from the [workshop](workshop.md), written as a buildable
specification.

## The piece in one paragraph

You float through an endless field of jelly membranes. They are translucent,
saturated sheets that fold through each other without edges, ends or joints.
Light passes through them and arrives coloured by however much jelly it
crossed. It lands on a satin silver floor as bright caustic folds, the three
colour plates slightly out of register. The whole world breathes on a
13-second cycle and wobbles at three rates that never line up. A drone built
from the overtones of struck glass has always been sounding. It opens when
the world inhales. When the light focuses hard, it glints. You lean with the
mouse and your body drifts after it, but the world never notices you. You
cannot map it, name it, or hum it.

## Principles (the three words as rules)

| Word | Rule | Verified by |
|---|---|---|
| Unknowable | Deterministic chaos. Incommensurate rhythms. No repeating landmarks. | Benjolin-clocked warp; frequencies 0.071 / 0.113 / 0.179 Hz have no small integer ratio |
| Unspeakable | No text after entry, no melody, no tonal centre. | UI is one entry mark only; drone pitches are inharmonic glass partials |
| Unarticulable | No edges, no joints, no attacks. Everything swells. | Gyroid membrane (no edges); drone has no envelopes triggered; bubble attacks softened |

## World

- **Form:** an infinite gyroid membrane, `|gyroid(p)| − thickness`. A slow,
  Benjolin-clocked domain warp displaces it, plus three wobble modes. It is
  confined to a vertical band above the floor.
- **Breath:** a 13 s cycle modulates membrane thickness (inflation).
- **Personal bubble:** the signed distance field excludes a sphere around the
  camera, so the viewer never enters jelly. Otherwise the world does not react to
  the viewer.
- **Floor:** satin silver plane. It reflects the sky and receives caustics.
- **Sky:** a gradient that cycles slowly through a palette series
  (the Printmaker). It is never static.
- **Fog:** hides the edge of the world. Its colour is drawn from the sky.

## Light model (from Jelly Baby)

These numbers are taken from the Jelly Baby renderer. The code is reimplemented,
not copied (see *Licensing* below).

- IOR **1.35**. Fresnel reflectance by Schlick's approximation at each surface
  (Jelly Baby uses exact unpolarised Fresnel for transport).
- **Beer–Lambert absorption per RGB channel:** transmittance =
  `exp(−σ_rgb × distance)`.
- **Flavours:** absorption coefficients σ (per metre in Jelly Baby; scaled to
  world units here):

  | Flavour | σ R | σ G | σ B | Source |
  |---|---|---|---|---|
  | lime | 48 | 3.2 | 85 | Jelly Baby |
  | strawberry | 10 | 44 | 56 | Jelly Baby |
  | blueberry | 14 | 8 | 3 | Jelly Baby |
  | lemon | 8 | 8 | 112 | Jelly Baby |
  | grape | 30 | 70 | 6 | new |
  | tangerine | 4 | 30 | 95 | new |
  | ink | 60 | 40 | 10 | new |

- A drifting 3D **flavour field** blends these coefficients in space.
  Colour is never assigned. It emerges from thickness × absorption.
- **Caustics:** the geometric convergence method from Jelly Baby. A grid of
  light rays is refracted through the jelly. Connected beam triangles are
  rasterised onto the floor, with intensity = source area ÷ landed area ×
  transmittance. Additive accumulation goes into a half-float target.
- **Extension:** true **per-channel dispersion** (one caustic pass per
  channel, each with its own IOR). Jelly Baby leaves this out. The IOR spread is
  the *misregistration* control.

## Viewer motion

- **Drift:** always moving forward at a slow base speed, even with no input.
- **Lean:** the pointer's offset from the screen centre, in [−1, 1]². x sets
  heading rate, y sets pitch, and magnitude adds speed.
- **Body:** heading, pitch and speed follow the lean through a damped spring
  (damping ratio < 1, so there's slight overshoot). Never instant.
- **Idle wander:** with no pointer for a few seconds, the heading drifts on a slow
  incommensurate sine.
- **Altitude** is clamped inside the jelly band with soft limits.
- Touch: pointer events, so a touch-and-drag acts as a lean.

## Sound (from JP-8)

A Rust crate compiled to WASM runs in an AudioWorklet. Modules copied from JP-8
(Apache-2.0, same owner), with provenance comments: `Oscillator` (PolyBLEP),
`IR3109`, `StereoChorus`, `Benjolin`, `ModalResonator`, `math`.

> **Revision (owner feedback, 2026-11-03):** the JP-8 bubble glints read as
> "really annoying chirping". Each was a short sine at a random pitch, up to
> 16 per second, and the whole bubble layer sat +3.9 dB over the mix. That
> broke this brief's own rule: no attacks. They are replaced by `GlintField`,
> slow raised-cosine noise swells that excite the wine-glass modal body.
> Pitch now comes from the glass modes, at most about 2 per second, and the
> layer sits about −9 dB under the drone. Enforced by `tests/glints.rs`.

Signal flow:

```
6 drone voices:
  2 × PolyBLEP saw (detuned by misregistration) → IR3109 ladder
  pitch = ROOT × glass-partial ratio (slow glide between ratios)
  amp & cutoff LFOs at the shared wobble frequencies
  cutoff ← breath, altitude, Benjolin
  → equal-power stereo pan (spread ← heading)
GlintField: 80–160 ms noise swells → ModalResonator (wine-glass body)
  rate 0.12–2.2 /s ← caustic convergence
Sum → StereoChorus (mix ← misregistration) → tanh soft limiter → out
```

- **No notes, no triggered envelopes.** A master fade-in of about 6 s happens
  on entry.
- **Zero heap allocation in `render()`.** All state is inline and fixed-size.
  JS reads and writes WASM linear memory through `Float32Array` views
  (pointer exports, no wasm-bindgen copy-back). `process()` creates no JS
  objects.
- Parameters travel from the main thread to the worklet as k-rate
  `AudioParam`s. These work without cross-origin isolation, unlike a
  SharedArrayBuffer. Inside `process()` they are copied into a pre-allocated
  WASM parameter block.

## Coupling (one knob, two senses)

| Shared signal | Range | Picture | Sound |
|---|---|---|---|
| breath | 0–1, 13 s period | membrane thickness | drone level, cutoff |
| wobble[3] | −1–1 at 0.071/0.113/0.179 Hz | form displacement | voice amp/pitch LFO |
| misregistration | 0–1 (speed + chaos) | IOR spread for dispersion | detune, chorus mix |
| agitation | 0–1 (lean magnitude) | warp speed | Benjolin depth |
| altitude | 0–1 within band | sky brightness | cutoff |
| heading | radians | flavour-field rotation | stereo spread |
| convergence | 0–1 | caustic gain | bubble rate |
| low band ← audio | 0–1 | interior glow | — |
| high band ← audio | 0–1 | caustic sparkle | — |

A single `Score` module on the main thread computes the signals once per frame
and writes them to both the uniforms and the AudioParams. Audio feeds back
through an `AnalyserNode` that reads into a pre-allocated `Float32Array`.

## Eras (long-period evolution)

> **Revision (owner feedback):** "after a few seconds it's kinda samey". The
> world tiled every ~100 units and the surface never changed family.

Minute-scale clocks with incommensurate periods (211–701 s) drive:

| Era signal | Picture | Sound |
|---|---|---|
| family (419 s) | gyroid ↔ Schwarz D ↔ Schwarz P, also varying by region | — |
| scale (337 s) | fine ↔ coarse cells (holds at each end for a third of the cycle) | — |
| turbulence (263 s) | warp amplitude | adds to agitation (Benjolin depth) |
| thickness (547 s) | gossamer ↔ gummy membranes | darker filter (`eraDensity`) |
| saturation (211 s) | pale ↔ deep absorption | — |
| light (613 s) | light azimuth, so the caustics wander | — |
| root (701 s) | — | drone transposition over 7 semitones (`eraRoot`) |
| drift (389 s) | very large-scale warp: whole regions slide | — |

The world period grew to ~402 units (K0 = 1/64). Tests show no two states
3+ minutes apart come back close within an hour.

## Floor (revision)

> **Owner feedback:** "very high frequency sparkly and doesn't seem to change much".

Measured with `tests/browser/floor.mjs` + `floor_metrics.py`, viewer pinned looking down:
- The sparkle was mostly the per-frame film grain (spatial sparkle 3.8 → 1.0,
  twinkle 5.3 → 1.4 once grain became dither-only), plus caustics read as
  isolated dots.
- An earlier "branch rejection" of caustic triangles discarded ~80% of the
  light (60% of the floor black). It was removed, and step-exhausted caustic
  rays now count as hits.
- Caustics are mipmapped, read with a mip bias so per-ray beads merge, and
  blended over ~0.2 s so folds glide instead of twitching.
- The floor is a swelling mercury mirror. Ripple height breathes and grows in
  turbulent eras, and its phases ride the warp/drift clocks.
- The adaptive resolution has hysteresis. It used to sawtooth every ~0.7 s,
  which visibly pumped the image.

## Image quality (revision)

> **Owner feedback:** "really stepped / low res. It looks like an Amiga demo".

Measured on frozen frames (`tests/browser/frame.mjs` + `frame_metrics.py`):
- Salt-and-pepper speckle came from the baked field volume. Trilinear
  interpolation has a discontinuous gradient, and refraction amplifies it.
  Exact marching fixed it but cost half the resolution.
- **Temporal anti-aliasing**: Halton-jittered samples are reprojected
  through camera motion using first-surface depth, variance-clipped and
  blended. It removes the speckle (0.15% → ~0%, also while moving) and the
  staircase edges, at 60 fps and render scale ~0.45 on an M2.
- Normals use the exact field; travelling uses the volume.

## Entry and duration

- Entry: a near-blank silver screen and one small mark. A click or tap creates
  the AudioContext and fades the world and the sound in over about 6 s.
- `M` toggles mute. The cursor hides after 3 s idle.
- Runs indefinitely. All time inputs are phase accumulators wrapped to
  [0, 2π) or to a period, so there is no float precision drift after days.

## Architecture

```
web/index.html            entry mark, canvas
web/src/main.js           boot, loop, entry, resize, adaptive resolution
web/src/score.js          shared signals (pure, unit tested)
web/src/viewer.js         drift + lean spring (pure, unit tested)
web/src/benjolin.js       control-rate port of JP-8 Benjolin for the warp clock
web/src/gl/*.js           WebGL2 passes: caustics, raymarch, present
web/src/gl/shaders/*.glsl
web/src/audio/engine.js   AudioContext, worklet, params, analyser
web/src/audio/worklet.js  AudioWorkletProcessor, raw WASM instance
engine/crates/xiu-dsp     DSP (JP-8 modules + drone engine), cargo tests
engine/crates/xiu-wasm    extern "C" pointer exports, no wasm-bindgen
```

Rendering is WebGL2 for reach, and needs `EXT_color_buffer_float` for the
caustic target. Each frame, the smooth pre-`abs` field value is **baked into a
256×256×48 R16F volume** around the viewer. The raymarch and caustic rays read
that volume, and sheets stay crisp because abs/thickness is applied after
interpolation. That brought the scene from ~26 ms to ~7 ms on an M2. The scene
renders at an adaptive internal resolution (about 0.7 at DPR 2), is
tone-mapped, then **FXAA**'d while upscaling.

## Licensing

Jelly Baby is **GPL-3.0**. Copying its code would make this project GPL. This
brief takes only its *published optical model and numeric constants* (IOR,
absorption coefficients, the area-ratio caustic principle) and reimplements them
in our own shaders. JP-8 is Apache-2.0 and owned by the project owner, so its
modules are copied with provenance comments.

## Acceptance criteria

1. Opening the page shows the entry mark. One click starts the visuals and the
   audio, and both rise from nothing over about 6 s.
2. Moving the pointer leans the viewer. Heading, pitch and speed respond with
   inertia and slight overshoot. With the pointer released, the viewer keeps
   drifting.
3. Jelly membranes are visibly refractive and coloured by thickness. Caustics
   are visible on the floor with RGB separation that grows with speed.
4. The drone is continuous, has no attacks, and swells audibly with the breath
   cycle. Glints are audible and their density follows caustic convergence.
5. Rust tests prove: bounded and non-NaN output under extreme parameters,
   non-silent output, cutoff response, and **zero allocations during
   `render()`** (counting allocator).
6. JS tests prove: viewer spring behaviour (overshoot, no snap, drift with no
   input), score signals in range, and no precision drift after a simulated
   week.
7. Browser smoke test: no console errors, a non-blank canvas, and the audio
   graph running after click.
8. Maintains ≥ 50 fps on an Apple-silicon laptop at default window size through
   adaptive resolution.

## Out of scope

- WebGPU path, VR, multiple viewers, recording/export.
- Exact Jelly Baby transport (BVH, 8-event TIR tracing, receiver atlas). We
  march a signed distance field instead and allow two interior layers.

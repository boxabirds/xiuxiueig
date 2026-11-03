# xiuxiueig

An interactive artwork: an endless, evolving jelly landscape you lean through
with the mouse, coupled to a generative drone. Theme: *unknowable,
unspeakable, unarticulable*.

- Design: [docs/design/workshop.md](docs/design/workshop.md) (simulated
  fictional three-artist workshop) and [docs/design/brief.md](docs/design/brief.md)
  (the buildable vision).
- Light model: reimplemented from the Jelly Baby optical model (IOR 1.35,
  Fresnel, Beer–Lambert flavour absorption, area-ratio caustics). No GPL code
  was copied.
- Sound: Rust DSP modules from JP-8 (with provenance headers) plus a new drone
  engine, compiled to raw WASM, running in an AudioWorklet.

## Run

```bash
bun install
npm run build:wasm   # needs rustup target wasm32-unknown-unknown
npm run dev          # http://127.0.0.1:5179
```

Click the small ring to enter (sound on). Move the pointer to lean. Press `M` to mute.

## Test

```bash
npm test              # Rust engine (incl. zero-allocation proof) + JS viewer/score
npm run test:browser  # needs `npm run dev`; real Chrome + GPU smoke test, screenshots in tests/browser/out
node tests/browser/eras.mjs            # screenshots across 25 minutes of eras
node tests/browser/position-sound.mjs  # measures how viewer state changes the audio
node tests/browser/floor.mjs && uv run --with pillow --with numpy tests/browser/floor_metrics.py  # floor sparkle/flicker/evolution
uv run --with pillow --with numpy tests/browser/colourfulness.py tests/browser/out/era-*s.png      # colour/contrast
node tests/browser/frame.mjs tests/browser/out/f.png 120 && uv run --with pillow --with numpy tests/browser/frame_metrics.py tests/browser/out/f.png  # speckle
```

Render the drone offline for listening:
`cd engine && cargo run --release --example render_wav -- /tmp/xiu.wav 40`

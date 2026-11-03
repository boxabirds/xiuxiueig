# Jelly asteroids (piece 2)

Fly through black space among giant jelly sweets, lit by a studio that travels
with you. The jellies are XPBD soft bodies: they squash on contact, merge for
good, and wobble. Each one hums a drone pitched by its size; squishes squelch,
and merges plop like water drops. The brief is in [docs/design/brief.md](docs/design/brief.md).

## Run

```bash
npm run build:wasm   # Rust -> web/assets/jelly.wasm (needs wasm32-unknown-unknown)
npm run dev          # http://127.0.0.1:5180  (node_modules is a link to piece-1's)
```

Click the ring to enter (sound on). Move the pointer to lean. Press `M` to mute.

## Test

```bash
npm test                                  # JS: spherical harmonics, XPBD physics, population, sound mapping
npm run test:rust                         # Rust audio engine incl. zero-allocation proof
npm run test:browser                      # real Chrome + GPU: fps, jellies in view, staged merge (screenshots)
node tests/browser/sound-probe.mjs        # live audio: drone present, merge adds squish + plop
```

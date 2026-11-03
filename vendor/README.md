# Vendored upstream sources

Exact copies of the upstream files these pieces draw on, pinned to the commits
below, for provenance and so the repository is self-contained. They are
**reference copies**: nothing here is built or imported. The code the pieces run
lives in `piece-1/` and `piece-2/`, and says in comments what it took from where.

| Upstream | Licence | Commit | Files | Used for |
|---|---|---|---|---|
| [scottstts/Jelly-Baby](https://github.com/scottstts/Jelly-Baby) | GPL-3.0 | `a030ccf097584472c792d7f0a97010add5b937c9` | `docs/optical-transport.md`, `docs/rendering-and-materials.md`, `src/graphics/optics/*`, `src/graphics/character/{baby,jelly-flavors}.ts` | Piece 1's optics, reimplemented in GLSL: IOR 1.35, Fresnel, Beer–Lambert flavour absorption (coefficients copied), area-ratio caustics |
| [boxabirds/jp8](https://github.com/boxabirds/jp8) | Apache-2.0 | `a63626f9f1865f7abfb6bb3b50f8ef34f21f6552` | `crates/jp8-core/src/{math,oscillator,filter,chorus,benjolin,bubble,modal}.rs` | Copied (with small `xiu:`-marked changes) into `piece-1/engine/crates/xiu-dsp`; piece 2's engine builds on those. `bubble.rs` was later replaced by `glint.rs` |
| [boxabirds/unixjelly](https://github.com/boxabirds/unixjelly) | GPL-3.0 | `ca02693f888a5214e72d062fadba16df844bc540` | `docs/{architecture,design}.md`, `src/engine/shell.html` (`jellyMaterial`, `studio`, `JellyStage`), `src/engine/jar-patch.py` (`LOOKS`, `BITS`, `paintJelly`) | Piece 2's jelly look (studio windows, deep attenuation colour, thin glow and rim, Neutral tone mapping), the palette, and the twelve jar looks |

Each upstream's own `LICENSE` is kept alongside its files. Apache-2.0 code is
compatible with this repository's GPL-3.0.

To refresh a copy: check out the upstream at a new commit, re-copy the listed
files, and update the commit hash here.

# Brief: *jelly asteroids* (piece 2)

## The piece in one paragraph

You fly through black space in a field of giant jelly sweets. Studio lights
travel with you, so every jelly is glossy and wet, with crisp window
highlights, deep colour where it's thick, and glowing edges where it's thin.
The jellies drift, turn slowly and wobble. Some carry chocolate chips,
sprinkles, glitter, stars or gold leaf; others are striped, swirled or two-tone
inside. When two touch, they melt into each other and become one bigger
jelly. New small ones keep drifting in from the dark ahead. The drone from
piece 1 hums underneath, and each merge rings.

## Decisions from the owner

| Question | Answer |
|---|---|
| Density | 12–15 jellies in the field at once |
| Size variation | 500%: largest radius = 5 × smallest |
| Shape | blobby |
| When jellies touch | **merge for good**. New jellies drift in to keep the count at 12–15 |
| Sound | reuse piece 1's engine, coupled to the asteroids |
| Physics | **XPBD soft bodies** combined with blend merging (owner: "combine them") |

## The look (from `~/expts/unixjelly`)

Unix Jelly's jelly reads as jelly, not pastel plastic, because of three things
(`docs/architecture.md`, "The jelly's look"). We keep all three:

1. **Light to reflect.** A studio of bright softboxes, so every jelly carries
   crisp window highlights. That's the strongest cue that something is wet and
   glassy.
2. **Colour that deepens through thick jelly.** A light surface tint, a deep
   saturated attenuation colour (lighter colours are deepened relative to
   their own lightness, so yellow doesn't turn brown), an inner glow where
   it's thin, and a rim.
3. **Neutral tone mapping**, because ACES greys the colours.

Palette: Unix Jelly's sweets `#ff4d6d #62c934 #3a5bff #ffc61a #ff8a2b #9b5cff`.

**Looks** (Unix Jelly's jar):
- **Layers in the jelly**: zebra, stripy, swirly, checked, two-tone and
  rainbow. The pattern colours the light passing through, so bands are clear or
  coloured *inside* the jelly. It's computed in the jelly's own coordinates, so
  it turns and wobbles with it.
- **Bits suspended inside**: chocolate chips (spotty), sprinkles, glitter,
  galaxy stars and gold leaf. They're seen through the jelly and bent by it.
  Here they're procedural: a jittered cell grid in the jelly's own space, hit
  while marching through the inside.
- Some are classic and plain.

Unix Jelly is GPL-3.0 (it ports Jelly Baby's wobble). As in piece 1, we take
techniques and parameters, not code.

## Space and light

- **Background:** black. The only additions are very sparse, faint pinpoint
  stars far away, so you can feel your speed and turning. Without some fixed
  reference, flight through empty black reads as a still image.
- **The studio travels with you.** The lights are fixed to the viewer, like a
  camera rig:
  - a big warm key softbox above and in front (four panes, as Unix Jelly's
    window),
  - a cooler fill softbox to one side,
  - two thin rim strips behind, to separate the jellies from the black.

  They light the jelly directly (glints, glow) and appear in reflections.
  Everywhere else the environment is black, so the jellies shine against
  space.

## Jellies

- **Count:** 12–15 inside the field, a sphere around the viewer.
- **Size:** spawn radius ranges from `R_MIN` to `R_MAX = 5 × R_MIN`, uniform in
  log size so small ones aren't rare.
- **Shape:** blobby. The rest shape is a sphere displaced by smooth,
  low-frequency noise. It breathes slightly with the shared breath.

### Soft bodies: XPBD shells + spherical harmonics

Each jelly is a **shell of 162 particles** (an icosphere) simulated with XPBD
(Macklin et al. 2016, written fresh, so no GPL code). It's held by:
- **shape matching** to its blobby rest shape, which carries its tumble
  (rotation extracted each substep);
- **edge** distance constraints between neighbouring particles;
- **contacts**: particles are pushed out of other jellies, so jellies **squash
  against each other** before merging;
- the viewer's **personal bubble**: particles are pushed out of it, leaving a
  dent that **springs back with overshoot** after you pass. Small jellies get
  batted aside.

Every frame, each shell's shape is fitted to **real spherical harmonics up to
l = 4** (25 coefficients) by quadrature over the icosphere. The renderer and
the contact test both read that same smooth radial function
`R(direction)`, so what you see is what collides. The cost: shapes are smooth
and star-shaped (no deep folds), which suits "blobby".
- **Motion:** slow drift and slow tumble, with no gravity. They spawn in the dark
  ahead (beyond the light's reach) and fade in. They are recycled once far behind
  you.

### Merging

1. Two jellies that touch first **squash** against each other (XPBD
   contact).
2. After about 0.6 s of contact they begin to **blend**: a smooth union whose
   blend radius grows, as metaballs do. Contacts switch off, and the two are
   drawn together over about 2.5 s.
3. When their centres are close, they become **one jelly**. Volume is
   conserved (`r = cbrt(r1³ + r2³)`), and so is momentum. Its shell starts in
   the shape of the blended pair and relaxes towards its own rest shape, which
   is the post-merge wobble, simulated rather than faked. It takes the bigger
   one's look, and the smaller one's colour becomes its second colour.
4. Several can merge into one. Sizes grow over time, but jellies are recycled
   behind you and new small ones spawn ahead, so the size distribution stays
   alive.
5. Contacts are **sticky**: rebounds lose most of their separating speed, so a
   bump becomes a press that turns into a merge, not a bounce. **Gentle mutual
   gravity** draws jellies together, so merges happen while you watch.

"12–15 at once" is read as **in view**. Jellies spawn in a cone ahead and are
recycled once outside a 62° view cone (wider than the visible field, so
nothing visibly pops). Measured: 11 of 12 in view.

## Viewer

- Piece 1's **drift + lean**: always drifting forward. The pointer leans
  heading, pitch and speed through damped springs. With no input, the heading
  wanders.
- Free flight in 3D, with no floor. Pitch is limited to ±70° so the horizon
  never flips.
- **Personal bubble:** jellies dent around you, so you can fly *through* one.
  You carve a tunnel, and the jelly stays a jelly around you.

## Sound

> **Owner revision:** "smooth drone, pitch as a function of the size of the
> jelly (with some harmonic variation), squishes and water drop plops".
> Piece 1's single global drone doesn't fit, so piece 2 has its own Rust/WASM
> engine (`engine/crates/jelly-audio`). It's built on piece 1's DSP modules
> (filters, chorus, noise), with zero allocation in `render()` (tested).

- **Drone:** up to 16 smooth voices, one per audible jelly, in stable slots.
  - Pitch = `55 Hz × n`, where `n ≈ 352 / (55 × radius)`, snapped to the
    harmonic series (bigger = lower, always consonant). A per-jelly seed moves
    it to a neighbouring harmonic.
  - Each voice has its own harmonic recipe (four partials plus a slow-beating
    twin): the timbral variation.
  - Pitch, gain and pan glide. A fused jelly inherits its bigger parent's
    slot, so a merge is heard as the pitch sliding down.
  - Gain falls with distance from the surface, and pan follows direction.
- **Squishes:** noise through two jittering resonant formants, driven by how
  much skin is being pressed: contacts, the melt of a merge, and flying
  through a jelly. The pitch follows the size of the jellies involved.
- **Plops:** a water drop on every merge. A short impact click, then a
  bubble resonance whose pitch rises (+90% in 25 ms), as real drops do. Bigger
  merges plop lower. Pan and level follow where it happened.
- **Breath** swells the drone gently. **M** mutes.

## Rendering

- WebGL2, one raymarched fragment pass. Jelly parameters arrive as uniform
  arrays (centre, radius, orientation, look, colours, merge partner, blend).
  Rays are first intersected analytically with the bounding spheres, so each
  pixel only marches the jellies it can actually hit.
- Up to 3 jelly layers per ray: Fresnel reflection of the studio, refraction
  in, Beer–Lambert colour, bits, and refraction out.
- TAA (reprojection + jitter) and FXAA from piece 1, Neutral tone mapping, and
  an adaptive resolution with hysteresis.

## Acceptance criteria

1. Opening shows the entry mark. A click starts the visuals and sound, fading
   in.
2. After warm-up, the field always holds 12–15 jellies (tested over a simulated
   hour).
3. Spawned radii fall in `[R_MIN, 5 × R_MIN]` (tested).
4. Merging conserves volume and momentum (tested), and the merged jelly takes
   the bigger one's look.
5. Two touching jellies visibly blend into one blob, then become one jelly
   (screenshot sequence).
6. All Unix Jelly looks appear: layered and bits (screenshot sheet).
7. Studio lights give crisp highlights against a black background, with no
   beige or grey haze (colour metrics as in piece 1).
8. 60 fps on an M2 at default window size, no console errors, low speckle
   (piece 1's frame metrics).
9. Sound reacts: merges swell the glints, and nearness to jellies brightens the
   drone (measured on the audio output).

## Out of scope

- Splitting jellies, a floor, caustics (there's nothing to receive them in
  space), and WebGPU.

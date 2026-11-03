# Workshop: *xiuxiueig*

**Theme:** unknowable, unspeakable, unarticulable
**Participants (fictional):** three invented artists:
- **the Sculptor** makes inflated, mirror-polished forms;
- **the Printmaker** works in repetition, screen prints and very long films;
- **the Kineticist** makes motion sculpture and paints straight onto film.
**Facilitator:** the project owner
**Inputs on the table:**
- *Jelly Baby* (scottstts/Jelly-Baby): a transmissive soft-body jelly rendered with
  physically based light transport. It uses IOR 1.35, Fresnel transmission,
  Beer–Lambert RGB absorption with per-flavour coefficients, and geometric
  caustics in which brightness is transported power divided by the area that
  receives it.
- *JP-8* (boxabirds/jp8): a Rust/WASM AudioWorklet synthesiser. It has PolyBLEP
  oscillators, an IR3109 ladder filter, a stereo BBD chorus, a Benjolin rungler
  for chaos, a Minnaert bubble generator and a modal resonator bank, and it does
  zero heap allocation in the render path.

> **Read this first.** This is a fictional conversation between three invented
> artists, used as a design tool. They are archetypes, not portraits of real
> people, and the works they mention are invented or described generically.

---

## 1. The three words

**FACILITATOR:** The brief is one sentence and three words. You can move with
the mouse. In front of you is a landscape that keeps evolving, in psychedelic
colour, made of forms that defy form. The words are unknowable, unspeakable and
unarticulable. The light comes from a jelly renderer and the sound from a synth
engine. Where do you start?

**PRINTMAKER:** I like that it's three words that all mean the same thing. That's
already a series. You could print them three times in three colours and that
would be the piece.

**SCULPTOR:** I don't hear negation in them. I hear generosity. *Unknowable* means
it is bigger than you, and that is a gift. You don't have to master it. You
can accept it. For me the art always happens inside the viewer, so the work
has to say yes to whoever is standing in front of it.

**KINETICIST:** I don't trust words for this anyway. I spent my life trying to get
motion to carry the meaning so I didn't have to explain anything. When I
scratched straight into black film stock, I wasn't illustrating
an idea. The scratch was the idea, and it jumped about at 24 frames a second. If
you can say what this world is, we've failed. The test is in your body: you
feel it in your gut before your head names it.

**FACILITATOR:** So a definition we can build from?

**KINETICIST:** *Unarticulable* is the useful one. An articulation is a joint, a hinge,
a place where one thing stops and the next begins. Musicians use the word too:
an articulated note has an attack. So: no joints, no hinges, no attacks. It's
continuous all the way through.

**PRINTMAKER:** And *unspeakable* means no words on the screen. No title card, no
"press here to begin" in nice type. Maybe one tiny thing so people know to
click. Tiny.

**SCULPTOR:** And *unknowable* means you can't learn it. No landmark you can find
again. If you come back tomorrow, it shouldn't be the same place.

**KINETICIST:** It has to be lawful, though. Random is boring. Wind isn't random and
you still can't predict it. I want deterministic chaos: rules you could write
down that still won't let you guess the next second.

**FACILITATOR:** JP-8 has a Benjolin. It's two oscillators that clock an 8-bit
shift register with XOR feedback. It's fully deterministic and it never quite
repeats.

**KINETICIST:** That's the wind. Use it.

> **Decision 1.** We read the three words as three rules:
> 1. **Unknowable:** deterministic chaos with no repeating landmarks. Rhythms
>    are incommensurate, so the whole system never returns to the same state.
> 2. **Unspeakable:** no text, no melody you could hum, no tonal centre.
> 3. **Unarticulable:** no edges, no joints, no attacks. Every visual and
>    sonic event swells in and swells out.

---

## 2. What it looks like: the jelly

**FACILITATOR:** Let me show you the jelly renderer. It's a 7 cm gummy figure.
Light goes into the body and refracts. Each colour channel is absorbed at a
different rate with distance, so lime takes out red and blue and keeps green.
The light comes out the other side and lands on the table as caustics. They
make the bright folds by measuring how much the refracted beams converge, not
by painting a pattern on.

**SCULPTOR:** That's my material. I've spent decades trying to get stainless steel
to look like a balloon, like something that's been breathed into. This is the
other way round: a balloon made of light. When I made my first mirror-steel piece, the
mirror surface meant you were in the work. You saw yourself in it. A jelly does
something more generous. It lets you see *through* yourself.

**PRINTMAKER:** I like that it's candy. Gummy candy is the most American material
there is. Everybody has eaten one. It's cheap and it's beautiful and you don't
have to explain it.

**KINETICIST:** What interests me is that the light *moves* when the jelly moves. The
caustic on the floor is a drawing the motion makes. That's the same thing as my
scratched film. The light is the scratch.

**FACILITATOR:** So the landscape is made of jelly?

**SCULPTOR:** The landscape *is* jelly. Not jelly objects on a landscape. The
ground, the hills, the sky folding over: all of it inflated, translucent, wet
with light.

**KINETICIST:** Not a skin of hills, though. If it's a terrain, people read it as a
place: a valley, a ridge. They articulate it. I want something with no top or
bottom. Membranes. Sheets that fold through each other and never close.

**FACILITATOR:** There's a mathematical surface called a gyroid. It's a
continuous membrane that divides space into two interwoven channels that never
meet. It has no flat faces and no edges. If you warp it slowly, it never looks
the same twice.

**KINETICIST:** No edges? Good. Use that.

**PRINTMAKER:** And then you repeat it forever. The gyroid repeats. That's my
favourite part. It's a pattern that goes on and on, but you warp it so each
repeat is a little bit wrong. Like a silkscreen where the plate slipped.

**FACILITATOR:** Say more about the plate slipping.

**PRINTMAKER:** When I did the screen prints, the colour and the black never lined
up perfectly. People thought it was a mistake. It was the best part. The face
is there three times, a little bit apart. You could do that with the light.

**FACILITATOR:** That's dispersion. The jelly renderer uses a slightly
different refraction index per colour, so red, green and blue bend by different
amounts and land a little apart.

**PRINTMAKER:** So the jelly is a silkscreen. Three plates. Turn it up.

**SCULPTOR:** Not so far that it's ugly. It should feel like a gift, never like a
glitch.

**PRINTMAKER:** Glitches are gifts.

**SCULPTOR:** Not to everyone.

> **Decision 2.** The world is an endless, slowly warped **gyroid membrane of
> jelly** floating over a pale satin floor that receives caustics. The
> renderer keeps the Jelly Baby light model: IOR ≈ 1.35, Fresnel, Beer–Lambert
> RGB absorption with flavour coefficients, and caustic brightness = power ÷
> area that receives it. We add one thing the original deliberately leaves out:
> **true per-channel dispersion** in the caustics. The Printmaker's misregistration is
> literal: three refraction indices give three plates.

---

## 3. Colour

**FACILITATOR:** The jelly gives us four flavours: lime, strawberry, blueberry
and lemon. Each is a set of absorption numbers per channel.

**PRINTMAKER:** Four's not enough. A series needs more. But don't make them nice.
Make them the colours on the shelf at the drugstore.

**SCULPTOR:** Add flavours, but keep the physics. The colour should come from how
far the light has travelled through the jelly. Thin membranes look pale, thick
folds look deep, and where two sheets overlap you get a third colour you never
asked for. That's what's wonderful about it: you don't choose the colour, the
thickness does.

**KINETICIST:** And the flavours have to move. Not cut from one to the next. They
should flow, like dye in water.

**FACILITATOR:** So a flavour field in space that drifts with time, and the
local mix of flavours sets the absorption at each point?

**KINETICIST:** Yes. And the sky shouldn't just be a background. It should be the
colour of the light that has come through.

**PRINTMAKER:** The sky should change colour like a series. Pink sky, then green
sky, then silver sky. Silver is important. Once I filled a
room with floating silver pillows. You walked through them and they
bumped into you. The silver was the walls, the floor, the people, all
reflected and all a bit wrong.

**SCULPTOR:** The floor should be silver then. A satin, polished floor that takes
the caustics. When the light comes through the jelly and lands on it, that's
the moment of joy.

> **Decision 3.** Seven flavours: Jelly Baby's four (lime, strawberry,
> blueberry, lemon) with their exact absorption coefficients, plus grape,
> tangerine and ink. Colour is **derived, never assigned**. It comes from
> the absorption × thickness travelled. Overlapping membranes produce
> unplanned colours. Flavours flow through space as a drifting field. The sky
> cycles slowly through a palette series, like a print run, and is never static. The floor
> is satin silver and receives the caustics.

---

## 4. Motion and the viewer

**FACILITATOR:** The viewer moves with the mouse. What does that feel like?

**KINETICIST:** It has to be bodily. I call it the body's own brain: the part of you that
knows what it is to swing, to fall, to sway, before you have any words. My
One of my pieces is just steel rods whipping, and people feel their spines move. The
mouse has to feel like that. Not like a cursor. Like leaning.

**FACILITATOR:** So the mouse position sets a direction you lean, and your body
follows with inertia?

**KINETICIST:** Inertia, yes. Overshoot, a little. A sway. Never instant. If the camera
goes exactly where the mouse is, you're steering a machine. If the camera
*wants* to go where the mouse is and takes its time, you're a body.

**PRINTMAKER:** I'd rather nobody moved. Just put the camera in one place and let it
run for eight hours. I once filmed a building for eight hours. People said it
was boring. That's what I liked about it.

**SCULPTOR:** Then they're not in it.

**PRINTMAKER:** They're never in it. That's the point.

**KINETICIST:** Here's the compromise. You drift whether you touch it or not. The world
carries you forward slowly, like a current. With the mouse you lean: left,
right, up, down, faster. Take your hand away and it carries you anyway. You
get your eight hours. I get my body.

**PRINTMAKER:** OK. Slow, though. Slower than you think.

**SCULPTOR:** And you must never crash into it. Nothing in the world should
threaten you. If you fly into a membrane, it parts. There's a little bubble
of air around you that the jelly always leaves alone. Like a gazing ball,
but you're inside it.

**FACILITATOR:** So the world deforms around the viewer?

**SCULPTOR:** Around the viewer, but it doesn't *respond* to the viewer. That
difference matters. It doesn't know you're there. It just can't touch you.

**KINETICIST:** Good. That keeps it unknowable. If it reacted, it would be a game, and
you'd start trying to figure it out.

> **Decision 4.** **Drift + lean.** The viewer always drifts slowly forward.
> The pointer's offset from the screen centre is a *lean*: it sets heading
> rate, pitch (which changes altitude) and speed. The camera follows that lean
> through a second-order spring with slight overshoot. It never snaps. With no
> input, the drift continues and the heading wanders by itself. A **personal
> bubble** of clear space surrounds the camera, so the viewer never clips into
> jelly. The world does not react to the viewer otherwise.

---

## 5. Motion of the forms

**FACILITATOR:** How do the forms themselves move?

**KINETICIST:** Oscillation. Everything I make oscillates: steel blades, twisting
strips, tall rods that sway in the wind. A piece of steel has a few frequencies it likes,
and when you drive it, it sings at those frequencies. That's the honest
movement of a material. So the jelly should wobble at a few frequencies. Not
one, because one is a metronome. Several, and they must never line up.

**FACILITATOR:** Incommensurate frequencies. Ratios that aren't whole numbers,
so the pattern never repeats exactly.

**KINETICIST:** And the same frequencies must be in the sound. Not similar. *The
same*. When I make a steel blade sing, the bending and the sound are one
event. You can't have the picture wobbling at one rate and the sound wobbling at
another. That's decoration.

**SCULPTOR:** And there should be one big, slow movement underneath: breathing.
Inflation. Everything I've made that looks inflated looks like it's holding a
breath. The whole world should inhale and exhale, slowly. Thirteen seconds,
maybe. It's not a rhythm you count. It's a rhythm you fall into.

**PRINTMAKER:** If it breathes, it's alive, and then it's a creature. I'd rather it
were a product.

**SCULPTOR:** A product can breathe. A balloon breathes.

**PRINTMAKER:** A balloon is *full of* breath. It doesn't breathe.

**KINETICIST:** Then it should breathe so slowly you're not sure it does. That's
unknowable too.

> **Decision 5.** Forms move by **three wobble modes at incommensurate
> frequencies** (0.071, 0.113 and 0.179 Hz) plus a **13-second breath** that
> thickens and thins the membranes. These exact numbers drive both the shader
> and the synthesiser. A slow **domain warp** is clocked by a Benjolin rungler,
> so the overall shape follows deterministic chaos.

---

## 6. Sound

**FACILITATOR:** The synth engine. It's a Jupiter-8 style virtual analogue.
There are two anti-aliased oscillators per voice, a four-pole ladder filter,
envelopes, LFOs and a stereo chorus. And some stranger modules: the
Benjolin, a bubble generator that synthesises bubbles from the physics of
bubble size and pitch, and a modal resonator that models struck glass, bells and
metal.

**PRINTMAKER:** No tunes.

**KINETICIST:** No notes, really. No attacks, remember. *Unarticulable*. The
envelopes are for articulating, so we hardly use them. It should be a drone that
has always been playing and always will be.

**FACILITATOR:** A drone needs pitches. Which ones?

**KINETICIST:** Pitches you can't sing. If you can hum it, you can name it, and then
it's speakable.

**FACILITATOR:** The modal resonator has a glass preset. Its mode ratios are
inharmonic: 1, 1.58, 1.85, 2.32, 3.24 and so on. They're the actual partials of
a struck glass.

**SCULPTOR:** So the drone is built from the overtones of glass. The jelly is the
material you see, and glass is the material you hear. A transparent body for the
eyes, a transparent body for the ears.

**KINETICIST:** And the voices should glide between those ratios slowly. Never jump.

**PRINTMAKER:** What do the bubbles do?

**FACILITATOR:** Each bubble is a tiny decaying sine. Its pitch comes from its
radius, and new bubbles spawn at random times.

**KINETICIST:** Those are the only articulations I'll allow. Tiny. Glints. When the
light focuses on the floor in a caustic, that's a glint of light. The bubbles
are glints of sound. Run them through the glass resonator so they ring. Soften
their attacks so they're more like twinkles than clicks.

**FACILITATOR:** So the density of the bubbles follows the brightness of the
caustics?

**KINETICIST:** Follows the *convergence*. When the light is focusing hard, the sound
glints more.

**SCULPTOR:** And the breathing has to be in the sound. When the world inhales, the
drone opens: the filter opens, it gets brighter and louder. When it exhales,
it closes.

**PRINTMAKER:** And the slipping plates? The dispersion?

**FACILITATOR:** The audio equivalent is detuning. Two oscillators per voice,
pulled slightly apart, beat against each other. And the chorus spreads the
sound in the stereo field.

**PRINTMAKER:** So when the colours slip, the sound slips. Same knob.

**KINETICIST:** Same knob. That's the rule for everything. One control, two senses.

**FACILITATOR:** What about the viewer's motion?

**KINETICIST:** When you lean harder and go faster, the world gets more agitated. Not
louder, more *agitated*. The Benjolin chaos goes deeper. When you're still,
it's calm and almost settles, but never quite.

**SCULPTOR:** And altitude. Up high, everything opens and gets airy. Down low near
the floor, it's warm and dark and close.

> **Decision 6.** The sound is a **continuous drone with no notes**. Six voices
> glide between **ratios taken from the glass partials** of JP-8's modal
> resonator, over a low root, so there's no tonal centre. Each voice is JP-8's
> two detuned PolyBLEP oscillators into an IR3109 ladder filter. A JP-8 Benjolin
> modulates the cutoffs. JP-8 **bubbles** with softened attacks run through the
> JP-8 **modal resonator** (wine-glass body) as *glints*. Everything ends in
> the JP-8 **BBD chorus** and a soft `tanh` limiter. The engine is a Rust
> crate compiled to WASM, allocation-free in the render path, inside an
> AudioWorklet.

---

## 7. The coupling: one knob, two senses

**FACILITATOR:** Let's write the table. Every control drives both senses.

**KINETICIST:** And it goes both ways. The sound has to feed back into the picture,
otherwise the sound is just reacting.

**FACILITATOR:** The audio's spectrum can be analysed on the main thread, and
the energy in the low, mid and high bands can feed back into the light.

**SCULPTOR:** Then the low drone should swell the glow of the world. The light
inside the jelly brightens when the drone is loud.

**KINETICIST:** And the highs, the glints, should sparkle in the caustics. A glint you
hear is a glint you see.

| Shared signal | Picture | Sound |
|---|---|---|
| Breath (13 s cycle) | membrane thickness, overall inflation | drone amplitude, filter cutoff |
| Wobble modes (0.071 / 0.113 / 0.179 Hz) | form displacement | per-voice amplitude/pitch LFOs at the same Hz |
| Misregistration (speed-driven) | per-channel IOR spread (dispersion) | oscillator detune, chorus mix |
| Agitation (lean magnitude) | domain-warp speed | Benjolin depth |
| Altitude | sky brightness, fog | filter cutoff (high = open) |
| Heading | flavour field orientation | stereo spread of voices |
| Caustic convergence (light-focus field) | caustic brightness | bubble spawn rate |
| ← Low-band energy (audio → picture) | interior glow of jelly | — |
| ← High-band energy (audio → picture) | caustic sparkle | — |

> **Decision 7.** One **Score** module on the main thread computes the shared
> signals every frame from time, the Benjolin clock and the viewer's motion.
> It writes them to the shader uniforms and to the synth's parameters together.
> Audio feeds back to the picture through an analyser: low band → interior
> glow, high band → caustic sparkle.

---

## 8. Disagreements we kept

**PRINTMAKER:** I still think there should be no mouse.

**KINETICIST:** And I still think there should be nothing *but* the mouse. We met in
the middle. It drifts without you.

**SCULPTOR:** I wanted you to see your reflection, the Printmaker wanted you
to see nothing, and the Kineticist wanted you to feel it in your body. We
ended with the bubble: you're protected, and you can't see yourself, but the
world moves around your body.

**PRINTMAKER:** I want one other thing. No ending. No score, no win, no fade to
black. If they leave the tab open, it should still be going in a week.

**FACILITATOR:** That's a technical requirement: no state that grows
over time, no precision drift. The clock has to wrap safely.

**PRINTMAKER:** Fine. Whatever that means.

**KINETICIST:** One more. When it starts, nothing should *start*. Clicking to enter
shouldn't feel like pressing play. The sound should rise from nothing over
several seconds, as if it was always there and you're only starting to hear it.

> **Decision 8.**
> - Entry is a near-blank silver screen with one tiny mark. One click (needed
>   by browsers for audio) fades the world and the sound in over ~6 seconds.
>   There's no "play" gesture.
> - It never ends: no goals, no UI, no score. The clock must run for days
>   without precision drift. Time inputs to the shader are wrapped and phase-
>   accumulated, never raw `performance.now()`.
> - A single key (`M`) mutes. The cursor hides after inactivity.

---

## 9. What each artist will look for in the result

**SCULPTOR:** That it's generous. Within three seconds you should feel welcomed,
not tested. The colours should be saturated and joyful, never murky.

**PRINTMAKER:** That it doesn't explain itself. That it's a little bit boring in a
good way. That the colours slip.

**KINETICIST:** That you feel it in your spine when you lean. And that if you close
your eyes, you can still tell when the world breathes.

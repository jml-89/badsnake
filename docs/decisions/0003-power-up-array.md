# ADR 0003 — A diversified, emoji-presented power-up array

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

The game had exactly one power-up: an amber square that switched steering to
analog. Both the *kind* and its *presentation* were hard-coded — `powerup` was a
bare `Vec2 | null`, collecting it set `mode = "analog"` inline in the movement
code, and the renderer drew a fixed amber cell. That shape does not extend to a
menu of effects, and "amber square" says nothing about what a token does.

We want an *array* of power-ups, each with a distinct effect, and a presentation
that names each one at a glance. Three new effects motivated the change, chosen
to exercise different parts of the system:

1. **Portal** — turn the lethal walls off; the board edge wraps Pac-Man-style.
   (A movement/collision-boundary change.)
2. **Digital** — the inverse of the analog power-up: snap steering back to the
   cardinal grid. (A mode transition we never had to make before.)
3. **3D** — render the snake with real depth. (A rendering-only flourish that
   starts stretching the three.js scene the orthographic camera always kept in
   reserve.)

## Decisions

### A power-up is a `{ kind, pos }` value; the kind → effect map lives in one place

`GameState.powerup` becomes `Powerup | null` where `Powerup` carries a
`PowerupKind` (`"analog" | "digital" | "portal" | "threeD"`) alongside its cell.
Spawning draws **two** seeded values — the cell, then the kind — so both the
where and the what stay a deterministic function of the seed. Collection is
detected in the movement strategies (which already walk the head over cells) and
reported up as the collected `kind`; the shared tick epilogue then applies the
effect through a single `applyPowerupEffect(state, kind)` switch. Effects are
persistent state changes (matching the original analog power-up), not timed — it
is the *token* that is transient, vanishing on its TTL if unclaimed.

Keeping the kind → effect mapping in one pure function (rather than inline in
each mover) is what makes "add another power-up" a localized change.

### Presentation is the renderer's job — an emoji on a coloured chip

The kernel carries only the `kind`. The renderer owns the kind → glyph mapping
and draws each token as a **billboarded textured quad**: a tinted rounded chip
with the kind's emoji centred on it (🕹️ analog, 📐 digital, 🌀 portal, 🧊 3D).
The chip's accent colour is load-bearing, not decoration — emoji fonts vary by
platform (and are absent on some headless Linux builds), so the tinted chip
guarantees the token still reads as a distinct pickup when the glyph itself does
not render. This keeps presentation entirely out of the pure model, exactly as
the renderer-as-sink boundary intends.

(We reached for `THREE.Sprite` first; it would not render under the project's
headless swiftshader setup. A textured quad billboarded to the camera each frame
is the reliable equivalent and reuses the same mesh path the cells already use.)

### Portal: wrapping is a boundary rule in the movement strategies

`edgeWrap` (a boolean on the state) replaces "leaving the board is always fatal"
with "fold the head back onto the opposite edge." The wrap is applied in each
mover the moment the head goes out of bounds, using one `wrapAxis` helper that
works for both integer cardinal cells and continuous analog floats. Two
consequences worth recording:

- **Collision across the seam is lenient by construction.** Self-collision uses
  raw Euclidean distance over the body polyline; a wrapped head is *far* from the
  body it just left, so it cannot false-positive across the seam. The failure
  mode is forgiveness (you may pass through the seam), never a phantom death —
  the right trade-off for a fun power-up.
- **The renderer snaps, doesn't glide, across the seam.** Analog interpolation
  would otherwise slide a wrapped node all the way back across the board; a
  per-axis jump larger than a threshold is drawn at its destination instead.

### Digital: re-quantize the body when returning to cardinal

Cardinal movement assumes an integer head on a cardinal heading. An analog snake
satisfies neither, so `digital` runs `snapToCardinal`: every body node rounds to
its containing cell (clamped inside the board) and the heading snaps to the
nearest cardinal, with the steering accumulators reset. The curvy body becomes a
crisp stair-stepped one — a visual tell that the snake "went digital" — and
quantized movement resumes cleanly. It is a no-op when already cardinal.

### 3D: a render-only flag, a second camera, lit blocks

`threeD` is a boolean the kernel carries but **movement and collision ignore** —
it cannot affect the simulation, so determinism and replay are untouched. When
set, the renderer switches from the flat orthographic camera to a tilted
perspective camera and draws the snake/food as raised, lit boxes (the head
stands taller). The flat path is left byte-for-byte unchanged, so the mode we
ship in stays exactly as it was — this only adds a branch.

## Consequences

- `GameState` gains `edgeWrap` and `threeD` booleans and a typed `Powerup`. The
  game remains a pure, deterministic fold over `(seed, intent stream)`; the two
  new RNG draws per spawn shift the sequence, but there are no persisted
  recordings to migrate.
- Adding a fifth power-up is now: add a `PowerupKind`, a case in
  `applyPowerupEffect`, and a `{ emoji, accent }` entry in the renderer. No
  movement-mode surgery.
- The composition root gained URL-param demo overrides
  (`?3d=1&portal=1&powerup=analog&mode=analog&seed=N`) so any power-up state can
  be viewed — or screenshotted headlessly via `REPRO_QUERY` — without playing up
  to it. This is a debug affordance in `app/`, not kernel surface.

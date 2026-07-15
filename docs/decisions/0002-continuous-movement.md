# ADR 0002 — Fixed fine timestep, velocity movement, per-mode strategies

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

Analog mode (unlocked by the joystick power-up) felt bad to play: you steer
through a continuous angle, but the snake lurched forward one whole cell at a
time. The cause was structural, not cosmetic. The simulation used the **tick
interval itself as the movement speed** — one cell per tick, the interval
shrinking with score (200 ms → 75 ms). That single number was doing three
unrelated jobs at once:

1. how far the snake moves (a cell per tick),
2. how often the heading can change (steering ran once per tick),
3. how often buffered input was serviced (drained once per tick).

At 200 ms that means ~5 steering updates a second and up to ~200 ms of input
latency — fine for a grid game, wrong for continuous control. Rendering made it
worse: the renderer ignored the render-time `alpha` it was handed, so the body
teleported a cell each tick with no interpolation.

A second forcing question: what happens when we add a moving enemy (a slow
bullet falling top-to-bottom)? Whatever movement model we pick, we need body
collision that does not care how a thing moved. That pushed us to separate
**movement** from **collision** explicitly.

## Decisions

### One authoritative timeline, a fixed *fine* step

There is exactly one sim clock: a fixed-timestep integer tick advancing
`SIM_DT_MS = 50` of simulated time (a subdivision of a cell, not the speed). The
only other clock is render (rAF + `alpha`), and it is a pure sink. Coarser or
finer rhythms (AI cadence, swept collision) are **subdivisions of the sim
timeline** — counters and inner substeps — never additional wall-clocks. Adding
clocks fractures the timeline and breaks replay determinism.

### Speed is a velocity

The difficulty curve is now expressed as cells/ms (`cellIntervalMs(score)`
inverted), read inside movement, instead of being the tick interval. Same feel,
but steering and input are serviced every fine tick — responsive and smooth.

### Movement is a per-mode strategy; collision is one uniform system

Within a tick an ordered pipeline runs `steer → move → collide`:

- **Cardinal movement is quantized.** Distance accrues into `cellProgress`; each
  time it crosses a whole cell the head commits one exact integer step. The grid
  snap is guaranteed by construction, independent of the timestep. Cardinal
  steering buffers into `pendingHeading` (first legal turn per cell, reversals
  rejected against the committed heading), so the fine step neither drops nor
  double-applies a turn.
- **Analog movement integrates** `velocity·dt` into a continuous head, laying
  trailing body nodes at ~1-cell arc spacing.
- **Collision is one distance-based system** over the uniform `[head, …body]`
  polyline (`selfHit`, neck-skipped by arc length). It is identical for both
  modes and is exactly the test a future falling bullet would run against the
  same body — so that enemy is new movement + a shared collider, touching neither
  mode.

### Rendering interpolates analog, snaps cardinal

The renderer finally uses `alpha`. Analog draws the body `alpha` of the way
between the previous and current tick — continuous motion. Cardinal is drawn raw:
its guaranteed integer snap is the point of the mode, and interpolating it would
only smear the grid.

## Consequences

- The strict "cardinal is byte-identical to integer-grid snake every tick"
  invariant is relaxed to "cardinal lands on exact integer cells at every commit"
  — its snap and no-reverse rules are preserved and tested, but the mechanics are
  now expressed through the shared pipeline. Kernel tests were rewritten to assert
  these guarantees rather than the old one-cell-per-tick mechanics.
- Power-up timing moved from integer ticks to milliseconds (`clockMs`) so its
  cadence is stable regardless of the timestep, while staying a deterministic
  function of the fixed `dt`.
- `GameState` gained `head`-first snake semantics plus `cellProgress`,
  `pendingHeading`, `lengthCells`, and `clockMs`. The game remains a pure,
  deterministic fold over `(seed, intent stream)`.
- Adding a moving hazard is now a localized change: register an entity with a
  velocity and a collider; the movement pipeline integrates it and the existing
  collision system tests it. No movement-mode changes required.

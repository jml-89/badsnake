# Architecture

This document sets the structural stakes for the project **before**
implementation, so we don't drift into an accidental shape. Everything here is a
starting position, not dogma — but the boundaries below are load-bearing and
should be changed deliberately, not by accident.

## Guiding idea: a pure kernel behind ports

We follow a **hexagonal** ("ports and adapters") architecture, or at least
something close to it. The point is a hard split between two kinds of code:

- **Pure kernel** — deterministic functions. Given the same inputs, always the
  same outputs. No I/O, no clock, no randomness, no DOM, no GPU. This is where
  the *game* lives, and it is trivially testable.
- **Impure shell** — everything that talks to the outside world: the clock, the
  renderer (three.js), input devices, storage, the RNG source.

The kernel defines **ports** (interfaces describing what it needs from the
world). The shell provides **adapters** (concrete implementations of those
ports). A single **composition root** wires adapters into the kernel and runs
the loop.

```
         ┌─────────────────────── app (composition root) ───────────────────────┐
         │  owns real time & randomness, constructs adapters, wires, runs loop    │
         └───────────────┬───────────────────────────────────┬───────────────────┘
                         │ injects                            │ injects
                         ▼                                    ▼
   ┌───────────── adapters (impure) ─────────────┐   ┌───────── core (pure) ─────────┐
   │ three.js renderer · browser clock · input · │──▶│ game rules · ecs · ports (types)│
   │ storage · seeded RNG                        │   │ tick(state, inputs, dt) → state │
   └─────────────────────────────────────────────┘   └───────────────────────────────┘
         adapters may import core      core may NOT import adapters or app
```

## Directory layout

```
src/
  core/            # PURE. deterministic. the game itself.
    game/          #   snake rules: tick, movement, collision, growth, scoring
    ecs/           #   entity/component/system primitives (pure data + functions)
    ports/         #   TYPES ONLY — interfaces the core needs from the world
  adapters/        # IMPURE. implements ports against real platform capabilities.
    render/        #   three.js scene, orthographic camera, meshes
    clock/         #   performance.now-based time sources
    input/         #   keyboard / DOM input
    rng/           #   seeded RNG implementation
    storage/       #   high scores etc.
  app/             # COMPOSITION ROOT. the only place allowed to import both sides.
    main.ts        #   builds adapters, wires the kernel, owns the run loop
```

The folder a file lives in **is** its purity contract. `core/` is pure by
construction; `adapters/` and `app/` are where impurity is allowed to live.

## Time is a dependency (dependency injection)

This is a game: time is injected almost everywhere. The kernel must **never**
read a clock itself. Instead, time arrives as **plain data** passed into pure
functions, and the composition root is the only thing that touches
`performance.now()`.

We deliberately distinguish several *kinds* of time, each its own dependency:

- **Simulation / physics time** — advances in a **fixed timestep** (integer tick
  counter). Pure kernel functions receive `dt` (or the tick index) as an
  argument. This is what makes the game refresh-rate independent and
  deterministic.
- **Render time** — the interpolation factor `alpha ∈ [0, 1]` between the last
  and next simulation tick. Lives entirely in the **renderer** (impure); the
  kernel never sees it.
- **AI time** — typically a *coarser* cadence than physics (e.g. an AI step
  every N sim ticks, or its own accumulator), so behaviour can be slowed,
  paused, or single-stepped independently of movement.

Each clock is a dependency that can be swapped: a real clock in production, a
hand-cranked clock in tests, a paused/stepping clock for debugging. Because the
kernel receives time as data, **tests need no fake timers** — you just call
`tick` with the `dt` you want.

The fixed-timestep run loop (owned by `app/`, refresh-rate independent,
background-tab safe via the accumulator clamp):

```ts
const TICK_MS = 120;              // simulation cadence — the game's speed
let acc = 0, last = performance.now();

function frame(now: number) {
  acc += now - last; last = now;
  acc = Math.min(acc, 250);       // clamp: no catch-up spiral after a hidden tab
  while (acc >= TICK_MS) {
    state = tick(state, inputs, TICK_MS);   // PURE kernel step
    acc -= TICK_MS;
  }
  render(state, acc / TICK_MS);   // impure; second arg is render-time alpha
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

## Randomness is a dependency too

The same rule that applies to clocks applies to `Math.random()`: it is impure
and non-deterministic, so the kernel never calls it. Random needs (food
placement, later: enemy behaviour) go through an **RNG port** — a seeded
generator passed in. Same seed → same game, which makes runs reproducible and
tests exact.

## Dependency injection: wire it by hand

We are doing dependency injection **conceptually**, not with a framework. No
container, no decorators, no reflection. The composition root constructs the
adapters and passes them (as their port interfaces) into the kernel. The
*ports* are the seams that make this DI; the *wiring* is just calling
constructors and functions in `main.ts`. If we ever outgrow manual wiring we can
introduce a container behind the same seams — but we almost certainly won't.

## Entity management: ECS-lite, also wired by hand

We are **not** committing to a full ECS with a query engine. But we adopt its
data shape from the start, because it composes cleanly with a pure kernel:

- **Entity** — just an id.
- **Component** — plain data (a position, a velocity, a renderable tag). No
  methods, no behaviour.
- **World** — collections of components keyed by entity id.
- **System** — a **pure** function `(world, inputs, dt) → world`.

Systems live in `core/` and are pure. To begin with there is **no query DSL** —
a system simply iterates the component collections it needs. This is the same
"manual wiring first" philosophy as the DI: start with the plain version, earn
the elaborate query layer only if the game actually demands it. The data model
won't have to change when/if we add real queries.

## Tooling: lean hard on lint and test

The architecture above is only real if it is *enforced*. Convention that lives
only in a document rots. So we push the linter and tests harder than the
defaults:

### Linting

Start from a strong TypeScript + ESLint baseline and tune it **up**, notably:

- `@typescript-eslint` with **type-aware** rules enabled (needs `project` set),
  so lint understands types, not just syntax.
- Strict `tsconfig` (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`).

### Import linting — the purity boundary (non-negotiable)

We enforce the pure/impure split **mechanically**. The rule is one-directional:

> Impure code may import as much pure code as it wants.
> **Pure code may not import impure code. Ever.**

Concretely:

- `core/**` may import only from `core/**` (and side-effect-free vendor types).
- `core/**` may **not** import `adapters/**`, `app/**`, `three`, or any
  DOM/browser API.
- `adapters/**` may import `core/**` (especially `core/ports`) but **not**
  `app/**`.
- `app/**` may import anything — it is the composition root.

This is enforced with an import-boundary linter. Primary candidate:
**`eslint-plugin-boundaries`** (declare each folder as an element type with an
allow-list of what it may depend on), giving in-editor feedback. Optionally
**`dependency-cruiser`** in CI as a second gate and to generate a dependency
graph. A violation is a **build failure**, not a warning.

### Enforcing "no clock / no randomness in the kernel" at the syntax level

Import rules stop the kernel importing an *impure module*, but time and
randomness also leak through **globals**. So inside `core/**` we additionally
ban the impure globals with an ESLint override
(`no-restricted-globals` / `no-restricted-properties` / `no-restricted-syntax`):

- `performance`, `Date`, `requestAnimationFrame` — time must be injected.
- `Math.random` — randomness must come through the RNG port.
- `window`, `document`, `localStorage` — no DOM/storage in the kernel.

This is what actually makes "time is injected everywhere" a rule the compiler
helps keep, rather than a habit we hope to remember.

### Testing

- **Vitest** over the pure kernel: movement, collision, growth, wrap/death
  conditions, scoring, and seeded-RNG determinism (same seed → same sequence).
- Adapters get thin-to-no unit tests; they are exercised by integration/manual
  runs. The whole reason the kernel is easy to test is that time and randomness
  arrive as arguments — **no mocking of clocks or the DOM required**.

## Summary of the load-bearing rules

1. Game logic is pure and lives in `core/`.
2. Time and randomness are injected as data/ports — the kernel never reads them.
3. Ports are types the kernel owns; adapters implement them; `app/` wires them.
4. DI and ECS both start as **manual wiring** — no framework, no query engine —
   with seams that allow elaboration later.
5. The pure→impure import ban is enforced by lint and fails the build.

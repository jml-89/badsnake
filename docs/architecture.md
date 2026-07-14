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
    input/         #   devices + bindings → emits intents (never raw keycodes)
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
    state = tick(state, intents, TICK_MS);  // PURE kernel step; `intents` is the
                                            // buffered intent stream (see Input)
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

## Input is virtualized: intent, not keystrokes

Input is a dependency like time and randomness, but it deserves its own
treatment because it is almost always **virtualized at least once**. The kernel
must consume the player's *intent*, never a device event. This keeps the kernel
device-agnostic and — the real payoff — makes input trivial to drive in tests
without dragging in keycodes, gamepads, or mappings.

We model it as three layers on the impure side, with the kernel behind all of
them. This is the *expression of intent → intent → carrying out intent* split:

1. **Devices** (adapter, impure) — keyboard, gamepad, mouse, accelerometer. Each
   emits its own raw signals (a keycode, a stick axis, a tilt vector). This is
   the *expression* of intent, and it is the only layer that knows a device
   exists.
2. **Bindings / mapping** (data-driven) — a keymap that translates raw device
   signals into intents. Remapping and multi-device support live here. Because a
   binding set is just **data** (`ArrowUp → Steer(North)`, `stick-left →
   Turn(Left)`), it is serializable (dovetails with save/load) and multiple
   devices simply merge into one intent stream.
3. **Intent** (the port vocabulary) — a small, **device-agnostic** semantic
   language of what the player *wants*: e.g. `Steer(Dir)`, `Turn(Left|Right)`,
   `Pause`, `Confirm`, `Restart`. This is the port boundary. The kernel never
   sees a keycode, a stick, or a tilt — only intent.

The kernel then **carries out** the intent under game rules (pure).

### Absolute vs relative intent — resolved in the kernel

Directional input has two semantic flavours, and both must be supported cleanly:

- **Absolute** — "face North" (natural for arrow keys, d-pads).
- **Relative** — "turn left from the current heading" (natural for two-button
  controls, single-hand play, an accelerometer).

A relative intent can only be resolved against the **current heading**, which is
kernel state. Resolving it in the mapping layer would leak game state outward and
break the boundary. So: the intent vocabulary carries **both** absolute
(`Steer(Dir)`) and relative (`Turn(Left|Right)`) intents, and the **kernel**
resolves the relative ones (it owns the heading). The mapping layer stays
stateless, and every controller style is supported without special-casing.

### Intents are buffered; two game rules live in the kernel

Intents are collected per frame and handed to `tick` as a **buffer** (the
`intents` argument in the loop above), drained per simulation tick. Two
snake-specific rules follow, and both belong in the **pure kernel**, not in
device code — which is only possible because intent arrives as data:

- **At most one heading change per tick.**
- **Reject illegal 180° reversals.**

Together these kill the classic bug where pressing up-then-left within a single
tick reverses the snake into itself. The kernel applies the first *legal* turn in
the buffer per tick.

### Testing

Tests feed a sequence of intents directly — `[Steer.North, Pause, Steer.East]`
or `[Turn.Left, Turn.Left]` at a known state — with **no device, no keymap, no
keycode** anywhere in the test. That is the whole point of virtualizing input.

## Determinism buys replay: the game is a fold over the intent stream

The previous decisions combine into one property that is worth stating as an
explicit design goal, because it shapes how we model `state`:

> The kernel is **pure**, simulation time is a **fixed-timestep integer tick**,
> and randomness is **seeded**. Therefore the entire game is a deterministic
> function of `(seed, intent stream)`:
>
> ```
> finalState = intents.reduce(tick, initialState(seed))
> ```

### Recordings are seed + tick-stamped intents, not state snapshots

Because of the equation above, a complete recording of a session is just the
**seed** plus the **sparse, tick-stamped intent stream** (`at tick 47:
Turn(Left)`). That is kilobytes for a long game, and it is *lossless* — replay
reconstructs every frame exactly. State is derived, not stored.

**Record at the intent layer, never the device layer.** Intent is
device-agnostic and sits *above* bindings, so an intent recording:

- replays identically regardless of the device it was captured on, and
- **survives the player rebinding their controls**, because bindings are
  upstream of the recorded data.

Recording keystrokes would be brittle on both counts; recording intent is
portable and rebind-proof. This is the second payoff of virtualizing input.

### What this unlocks

- **Replay** — play back any session.
- **Attract / demo mode** — the game plays itself from a recorded stream.
- **Ghosts** — race a recording of a past run alongside the live one.
- **Bug repro as an artifact** — a bug report *is* a seed + intent stream; replay
  drops you into the exact failing state (time-travel debugging, for free).
- **Tests as recorded sessions** — a golden intent stream + expected final state
  is a full-fidelity integration test authored by simply playing.
- **A path to rollback netcode** — not a goal, but this is exactly its substrate,
  so nothing here forecloses it.

### Total determinism is the price — and our lint rules are what pay it

Replay is exact only if determinism is **total**: every source of
nondeterminism must go through a port. This is the *same* boundary the import
lint and the banned-`core`-globals already enforce — so those rules stop being
mere tidiness and become the guarantee that **replay cannot silently diverge**.
A stray `Date.now()` or `Math.random()` in the kernel would corrupt every
recording; the linter failing the build is what keeps the stream honest. One
boundary, two payoffs: testability and reproducibility.

JS-specific commitments this relies on:

- We depend on `Map`/`Set` iteration being **insertion-ordered** (it is) and
  avoid anything hash-ordered or wall-clock-seeded.
- The integer **tick index** is the timeline the stream indexes into — which is
  *why* simulation time is an integer counter, not a float of seconds.

### Keyframes are an optimization, not the source of truth

To seek within a long recording without replaying from tick 0, we may store
periodic state snapshots. These are a **cache/index** — the intent stream stays
canonical, snapshots are derived. One authoritative representation; snapshots
only where fast seeking is wanted.

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
- Input is tested by feeding **intent sequences** straight into `tick` — no
  device, keymap, or keycode in the test (see Input).
- Adapters get thin-to-no unit tests; they are exercised by integration/manual
  runs. The whole reason the kernel is easy to test is that time, randomness, and
  input all arrive as arguments — **no mocking of clocks, devices, or the DOM
  required**.

## Summary of the load-bearing rules

1. Game logic is pure and lives in `core/`.
2. Time, randomness, and input are injected as data/ports — the kernel never
   reads a clock, calls `Math.random`, or touches a device.
3. Input is virtualized to **intent**; the kernel consumes intent, resolves
   relative turns against its own heading, and enforces the one-turn-per-tick /
   no-180° rules.
4. The game is a deterministic **fold over `(seed, intent stream)`**; recordings
   are seed + tick-stamped intents (lossless, rebind-proof), which is what makes
   replay, demos, ghosts, and bug-repro possible.
5. Ports are types the kernel owns; adapters implement them; `app/` wires them.
6. DI and ECS both start as **manual wiring** — no framework, no query engine —
   with seams that allow elaboration later.
7. The pure→impure import ban is enforced by lint and fails the build — this is
   also what guarantees replay determinism cannot silently diverge.

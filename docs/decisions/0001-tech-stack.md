# ADR 0001 — Rendering and build stack

- **Status:** Accepted
- **Date:** 2026-07-14

## Context

We want a browser game that begins as a basic Nokia-style snake but is
explicitly expected to evolve into something richer over time. It is
single-player, runs entirely client-side as compiled JavaScript, ships as a
static build artifact from GitHub, and must be testable headlessly ("test
mode"). No online/multiplayer aspirations.

The tempting early mistake is to pick a "toy" that is either overkill or
limiting, and then fight it. We wanted to make the load-bearing decisions
deliberately, up front.

## Decisions

### Language & build: TypeScript + Vite

- **TypeScript** gives a typed, "serious" foundation without the cost of
  compiling from another language.
- **Vite** provides instant hot-reload during development and emits a plain
  static `dist/` on `vite build` — exactly the "compiled JS you run in the
  browser / host on GitHub Pages" requirement. No runtime server.
- **Vitest** covers test mode: because the game kernel is pure (see
  `../architecture.md`), the whole simulation is testable with no browser.

### Rust + WASM: rejected (for now)

Considered and explicitly declined. Snake — and even a grown-up version of it —
is a fixed-tick grid simulation with no hot compute loop, so WASM buys no
performance we would ever spend, while costing heavier builds, slower iteration,
worse in-browser debugging, and a JS shim for canvas/input anyway. Revisit only
as a *learning* exercise, not an engineering need, and if so via a light lib
like `macroquad`.

### Rendering: three.js with an orthographic camera

The real choice was never "Canvas 2D vs raw WebGL" (nobody hand-writes raw
WebGL for a game) — it was *which rendering abstraction to stand on*. Options
considered:

| Option | Model | Ceiling | Verdict |
|---|---|---|---|
| Canvas 2D | Flat immediate-mode 2D | Flat forever | Too limiting given growth plans |
| PixiJS | WebGL-backed **2D** (z = draw order only) | "2D, but with GPU effects" | Good, but no real depth |
| **three.js** | WebGL-backed **3D** scene + camera | Real z-axis, lighting, 2.5D, post-fx | **Chosen** |

**Why three.js:** it is the only option where "not necessarily 2D to *play* 2D"
is literally true. An **orthographic camera** (no perspective foreshortening)
pointed at a flat arrangement renders as clean 2D today, but the scene is
genuinely 3D underneath. Later we can add real lighting (a rounded-tube snake),
tilt the camera for 2.5D and cast shadows, zoom/swoop on events, and stack
post-processing — all **without touching game logic**, because rendering sits
behind a port (see architecture doc).

**Cost accepted:** a larger vocabulary to learn (scene, camera, geometry,
material, light) and roughly one evening of scene-graph concepts before the
first frame. This is paid once and, crucially, expands options rather than
constraining them. Given the project's stated goal of growing over time, a
renderer that can say "yes" later is worth more than the smaller upfront step.

### Distribution: GitHub Actions → GitHub Pages

`vite build` output is static, so CI builds it and publishes to Pages on every
push, yielding a playable URL per change.

## Consequences

- The renderer is isolated behind a port; swapping or extending it never touches
  the kernel, so this decision is reversible at low cost if three.js ever stops
  earning its keep.
- New contributors must learn three.js basics to work on rendering, but nothing
  else in the codebase depends on that knowledge.

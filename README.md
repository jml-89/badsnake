# badsnake

A browser game that starts as a Nokia-era snake and is meant to grow into
something more. Built to have fun with over time, which is exactly why the
architecture is taken seriously from the first commit.

## Stack

- **TypeScript + Vite** — typed kernel, instant hot-reload, static build output.
- **three.js** — a real 3D scene rendered through an **orthographic camera**, so
  it reads as flat 2D today but keeps depth, lighting, and camera work open for
  later without a rewrite.
- **Vitest** — headless tests over the pure game kernel.
- **GitHub Actions → GitHub Pages** — every push publishes a playable build.

## Why these choices

See [`docs/decisions/0001-tech-stack.md`](docs/decisions/0001-tech-stack.md).

## How the code is organised

See [`docs/architecture.md`](docs/architecture.md). The short version: a pure,
deterministic **kernel** that never touches time, randomness, the DOM, or the
GPU; **adapters** that provide those impure things; and a **composition root**
that wires them together. A linter enforces the boundary — pure code physically
cannot import impure code.

## Development

```sh
npm install       # install dependencies
npm run dev       # hot-reloading dev server
npm test          # run the pure-kernel test suite (Vitest)
npm run lint      # ESLint incl. the pure -> impure import boundary
npm run typecheck # tsc --noEmit under strict settings
npm run build     # typecheck + static production build to dist/
```

### Layout

```
src/core/      pure, deterministic kernel (game rules, RNG, ports)
src/adapters/  impure implementations (three.js renderer, clock, keyboard)
src/app/       composition root: wires adapters into the kernel, runs the loop
```

Controls:

- **Keyboard** — arrow keys / WASD to steer, Q/E to turn, Space to pause, R to
  restart.
- **Touch / mobile** — an on-screen D-pad (large, transparent, anchored
  bottom-right where a thumb rests) steers; on-screen Pause and Restart buttons
  stand in for the keys a phone doesn't have. Both devices feed the same
  device-agnostic intent stream, so the kernel never knows which one you used.

## Status

First playable build. The pure kernel, adapters, composition root, enforced
import boundary, tests, and CI/Pages workflows are in place, and the game is now
playable on both desktop (keyboard) and mobile (on-screen D-pad + HUD buttons),
with a live score readout and paused / game-over banners.

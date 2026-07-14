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
npm run repro     # headless-browser smoke test of the built dist/ (see CLAUDE.md)
```

### Playing a version from a feature branch

`main` publishes to <https://jml-89.github.io/badsnake/>. To try work that isn't
on `main` yet:

- **Locally** — `git checkout <branch> && npm install && npm run dev`, then open
  the printed `localhost` URL. For the exact production build instead of the dev
  server: `npm run build && npm run preview`.
- **Shareable link** — open a pull request. Every PR is built and published to a
  preview URL and a bot comments the link on the PR:
  `https://jml-89.github.io/badsnake/pr-preview/pr-<N>/`. The preview updates on
  each push and is removed when the PR closes.

> One-time repo setup for previews: **Settings → Pages → Source = "Deploy from a
> branch" → `gh-pages` / `(root)`.** Both the production and preview deploys
> publish to that branch.

### Layout

```
src/core/      pure, deterministic kernel (game rules, RNG, ports)
src/adapters/  impure implementations (three.js renderer, clock, keyboard)
src/app/       composition root: wires adapters into the kernel, runs the loop
```

Controls: arrow keys / WASD to steer, Q/E to turn, Space to pause, R to restart.

Power-ups: grab the amber **joystick** token to trade the four cardinal
directions for **analog steering** — the heading then turns continuously (bounded
per tick) instead of snapping 90°, so you carve curves rather than right angles.

## Status

First architecture build. The pure kernel, adapters, composition root, enforced
import boundary, tests, and CI/Pages workflows are in place. Gameplay is basic
snake — the foundation is what this build is really about.

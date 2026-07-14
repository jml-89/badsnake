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

## Status

Pre-implementation. The documentation is the current deliverable; the project
scaffold comes next.

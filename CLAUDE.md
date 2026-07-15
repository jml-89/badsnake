# CLAUDE.md — working notes for agents

Orientation lives in [`README.md`](README.md) and [`docs/architecture.md`](docs/architecture.md).
This file is the **operational** record: how to reproduce and verify things in
this repo without guessing. Keep it current — when you find a better way to
repro a class of bug, write it down here.

## The golden rule for visual bugs: look at the pixels

This game renders through three.js/WebGL into a `<canvas>`. That means a whole
class of bugs — culled geometry, off-screen cameras, wrong colors, z-fighting —
produce **no console error, no failed request, and no failing test.** The unit
tests cover the pure kernel (`src/core`), which can be 100% green while the
screen is black.

> If the report is "nothing renders" / "black screen" / "looks wrong",
> a screenshot is the primary evidence. Do not diagnose from logs alone.

### Two tiers: scene composition (browser-free) vs. pixels (screenshot)

Not every render check needs a browser. The renderer is split in two:

- **`scene-model.ts` decides *what* the frame contains** — camera choice, every
  node's interpolated position, the wrap-seam snap, the wall-lethal flag, the
  token — and returns it as **plain data with no three.js import**. That whole
  layer is unit-tested in Node with **zero browser** (`scene-model.test.ts`). If
  the bug is "token in the wrong place," "wrong camera," "border didn't recolour,"
  "analog smears across the portal seam" — reach for that test first; it's fast,
  deterministic, and runs in CI.
- **`three-renderer.ts` is the thin GL sink** — it only *places* what the model
  hands it. The bugs that survive into here are the genuinely pixel-level ones:
  culling/winding (the case study below), whether a primitive type renders at all
  under swiftshader (`THREE.Sprite` did not — tokens are billboarded quads),
  camera framing, and aesthetics. **Those still need a screenshot** (or a human
  looking at one). No headless browser-free WebGL path exists for this stack:
  three's `WebGLRenderer` requires a WebGL2 context, which Node has no maintained
  provider for.

So: put composition logic in the scene model and test it there; spend the
screenshot budget only on the pixel tail that truly needs it.

### Case study (why this file exists)

"Black screen on the deployed site." Reality: the page loaded, WebGL worked,
the canvas was present and sized, and there were **zero JS errors**. The grid
`LineSegments` rendered but every filled cell `Mesh` was invisible. Root cause:
the `OrthographicCamera` is built with an inverted Y (`top=0, bottom=rows`,
`three-renderer.ts`), which flips triangle winding, so back-face culling
discarded the `MeshBasicMaterial` planes (default `side: FrontSide`). Lines have
no faces to cull, so they survived — the one-sided symptom that named the bug.
Only the screenshot showed "grid yes, cells no." Confirmed by an A/B rebuild
with `side: DoubleSide`.

Takeaways that generalize:
- **Grid/lines visible but meshes missing** → winding / back-face culling,
  usually from a mirrored or inverted camera. Test with `side: DoubleSide`.
- **Everything missing** → camera frustum / positions off-screen, or `render()`
  never called. Log `scene.children` counts and camera params.
- Confirm any fix with a **second screenshot**, not by reasoning.

## Reproducing a rendering issue headlessly

`scripts/repro.mjs` builds nothing itself — it serves an existing `dist/` under
the **`/badsnake/` subpath** (mimicking GitHub Pages project hosting exactly),
drives it in headless Chromium, captures console / pageerror / failed requests /
HTTP ≥400, prints live DOM+WebGL probes, and writes a screenshot.

```sh
npm run build                 # produce dist/
npm i -D playwright           # one-time; not a runtime/CI dependency
node scripts/repro.mjs        # serves dist/ at /badsnake/, screenshots to repro.png
```

Then **read `repro.png`.** Compare against the same shot after a candidate fix.

### Screenshotting a specific power-up state

Power-ups (and the states they unlock) are otherwise reachable only by playing up
to them. The composition root reads **URL-param demo overrides** so you can jump
straight to one, and `repro.mjs` honours `REPRO_QUERY` / `REPRO_OUT` to drive
them headlessly:

```sh
# a token on the board (chip + emoji): powerup=analog|digital|portal|threeD
REPRO_QUERY="powerup=portal" REPRO_OUT="$PWD/tok.png" node scripts/repro.mjs
# an *effect* already active: 3d=1 (tilted 3D), portal=1 (walls off / cyan border),
# mode=analog (continuous steering), seed=N — combine freely
REPRO_QUERY="3d=1&mode=analog" REPRO_OUT="$PWD/fx.png" node scripts/repro.mjs
```

The overrides only pre-seed the *initial state* (see `applyDemoOverrides` in
`app/main.ts`); they touch nothing in the pure kernel. Note the headless capture
can catch a transitional first frame — if a token looks missing, re-run.

Notes for this environment:
- Chromium is pre-installed at `/opt/pw-browsers`; do **not** run
  `playwright install`. The script auto-detects that path and falls back to
  `PLAYWRIGHT_CHROMIUM` / a normal Playwright install.
- Headless WebGL needs a software GL backend — the script passes
  `--use-gl=angle --use-angle=swiftshader`. Without it the canvas is blank for
  the wrong reason.
- Serving at `/badsnake/` matters: it's the only way a base-path/asset-404 bug
  reproduces. The build uses `base: "./"` (relative), so assets resolve at any
  subpath — a real 404 here would be a genuine regression, not path config.

## Distinguishing deploy problems from render problems

- **Asset 404 / wrong base path** → the JS never loads; `#app` is empty, no
  canvas. Check the built `dist/index.html` references `./assets/...`.
- **Stale deploy** → Pages publishes only `main` (`.github/workflows/pages.yml`).
  A fix on a feature branch is not live until merged. Check which commit is
  actually deployed before assuming the code is wrong.
- **Render bug** → canvas present and sized, WebGL supported, no errors, but the
  screenshot is wrong. This is the case the golden rule above is for.

## Fast checks before/after any change

```sh
npm run typecheck   # tsc --noEmit, strict
npm run lint        # incl. the pure -> impure import boundary (load-bearing)
npm test            # pure-kernel Vitest
npm run build       # must pass before repro
```

The lint boundary is load-bearing: pure `src/core` code physically cannot import
impure adapters. If a fix wants to reach across it, that's a design smell — stop.

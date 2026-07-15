import * as THREE from "three";
import type { GameState, PowerupKind, Vec2 } from "../../core/game/types";
import type { Renderer } from "../../core/ports/renderer";
import { advanceInterp, composeScene, initialInterp } from "./scene-model";

const COLORS = {
  background: 0x0a0a0a,
  grid: 0x1c1c1c,
  wall: 0xdc2626, // danger red — the board edge is lethal, so mark it clearly
  wallOff: 0x22d3ee, // cyan — walls are down (portal power-up), the edge now wraps
  head: 0x7dd3fc,
  body: 0x38bdf8,
  food: 0xf43f5e,
} as const;

/**
 * How each power-up kind is presented: a single emoji on a colored chip, drawn
 * as a billboarded sprite over its cell. The kind → (glyph, accent) mapping is
 * the renderer's job — the pure kernel only carries the `kind`, so gameplay
 * stays free of presentation.
 *
 * The chip's accent colour is load-bearing, not decoration: emoji fonts vary by
 * platform (and are absent on some headless Linux builds), so the tinted chip
 * guarantees the token reads as a distinct pickup even when the glyph itself
 * fails to render. Where emoji are available they sit on top of the chip.
 *
 *   🕹️ analog  — continuous joystick steering (amber, echoing the touch knob)
 *   📐 digital — snap back to the 90° cardinal grid (green)
 *   🌀 portal  — walls off, the edge wraps (cyan, matching the wrapped border)
 *   🧊 threeD  — render the snake with depth (violet)
 */
const POWERUP_STYLE: Record<PowerupKind, { readonly emoji: string; readonly accent: string }> = {
  analog: { emoji: "🕹️", accent: "#facc15" },
  digital: { emoji: "📐", accent: "#4ade80" },
  portal: { emoji: "🌀", accent: "#22d3ee" },
  threeD: { emoji: "🧊", accent: "#a78bfa" },
};

/** Thickness of the danger border, in world (cell) units. */
const WALL_THICKNESS = 0.18;

/** How tall the 3D snake/food blocks stand off the board, in cell units. */
const BODY_DEPTH = 0.8;
const HEAD_DEPTH = 1.3; // the head stands taller so it reads at a glance
const FOOD_DEPTH = 0.6;

/** Traces a rounded-rect path on a 2D context (no roundRect dependency). */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Renders a power-up token into an offscreen canvas and wraps it as a texture: a
 * tinted rounded chip with the kind's emoji centered on it. The chip is what
 * makes the token legible even where the platform lacks the emoji glyph; the
 * emoji is drawn on top for the platforms that have it. Cached per kind — a
 * token reappears far more often than the handful of distinct kinds.
 */
function makeTokenTexture(emoji: string, accent: string): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const pad = size * 0.12;
  const box = size - pad * 2;

  // Tinted chip: translucent fill + a solid accent border, so the token reads
  // as a pickup at a glance regardless of emoji-font support.
  roundRectPath(ctx, pad, pad, box, box, size * 0.22);
  ctx.fillStyle = "rgba(28,32,42,0.94)";
  ctx.fill();
  ctx.lineWidth = size * 0.06;
  ctx.strokeStyle = accent;
  ctx.stroke();

  // The emoji on top (blank on platforms without the glyph — the chip carries it).
  ctx.font = `${Math.floor(size * 0.6)}px "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = accent;
  ctx.fillText(emoji, size / 2, size * 0.56);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * A deliberately thin three.js renderer. It stands up a genuine 3D scene viewed
 * through an ORTHOGRAPHIC camera by default, so today it reads as a flat grid —
 * but the z-axis, lighting, and camera moves are all available, and the 🧊 3D
 * power-up switches the snake into raised, lit blocks seen through a tilted
 * perspective camera. The renderer only composes what the kernel hands it.
 */
export function createThreeRenderer(
  container: HTMLElement,
  cols: number,
  rows: number,
): Renderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  const side = Math.min(container.clientWidth || 480, container.clientHeight || 480) || 480;
  renderer.setSize(side, side);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);

  // --- Cameras --------------------------------------------------------------
  // Flat: an orthographic top-down view. Board spans [0, cols] x [0, rows] in
  // world units; top=0/bottom=rows puts the origin at the top-left, matching the
  // kernel's grid coordinates.
  const flatCamera = new THREE.OrthographicCamera(0, cols, 0, rows, -10, 10);
  flatCamera.position.z = 5;

  // 3D: a perspective camera pulled above and in front of the board, tilted so
  // the raised blocks stand up toward the viewer. `up = (0,-1,0)` keeps the
  // kernel's y-down orientation (row 0 at the top) consistent with the flat view.
  const camera3d = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera3d.up.set(0, -1, 0);
  camera3d.position.set(cols / 2, rows * 1.65, Math.max(cols, rows) * 0.9);
  camera3d.lookAt(cols / 2, rows * 0.42, 0);

  // Lights for the 3D materials. Harmless in flat mode: the unlit MeshBasic
  // materials there ignore them entirely.
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(cols * 0.25, -rows * 0.4, Math.max(cols, rows));
  scene.add(keyLight);

  // Static grid lines.
  const gridMaterial = new THREE.LineBasicMaterial({ color: COLORS.grid });
  const gridPoints: number[] = [];
  for (let x = 0; x <= cols; x++) gridPoints.push(x, 0, 0, x, rows, 0);
  for (let y = 0; y <= rows; y++) gridPoints.push(0, y, 0, cols, y, 0);
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute("position", new THREE.Float32BufferAttribute(gridPoints, 3));
  scene.add(new THREE.LineSegments(gridGeometry, gridMaterial));

  // Danger border. Walls are lethal (leaving [0,cols]x[0,rows] kills the snake),
  // but nothing on screen said so — this frames the play area in a warning red so
  // the deadly edge reads at a glance. When the portal power-up turns walls off
  // the frame recolours to a calm cyan to signal the edge now wraps. Static
  // geometry: built once, never cleared with the per-frame cells. DoubleSide for
  // the same inverted-camera winding reason the cell meshes need it (see below).
  const wallMaterial = new THREE.MeshBasicMaterial({ color: COLORS.wall, side: THREE.DoubleSide });
  const wallGroup = new THREE.Group();
  const t = WALL_THICKNESS;
  function addBar(w: number, h: number, cx: number, cy: number): void {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMaterial);
    bar.position.set(cx, cy, 0);
    wallGroup.add(bar);
  }
  // Horizontal bars overhang by `t` so the corners meet cleanly.
  addBar(cols + t, t, cols / 2, 0); // top edge (y=0)
  addBar(cols + t, t, cols / 2, rows); // bottom edge (y=rows)
  addBar(t, rows + t, 0, rows / 2); // left edge (x=0)
  addBar(t, rows + t, cols, rows / 2); // right edge (x=cols)
  scene.add(wallGroup);

  // Shared, reused resources. Two sets: flat quads (unlit) for the top-down view,
  // and lit boxes for the 3D view.
  //
  // DoubleSide on the flat quads is load-bearing: the orthographic camera above is
  // built with an inverted Y (top=0, bottom=rows) to get a top-left origin, which
  // flips triangle winding. With the default FrontSide, back-face culling would
  // discard every cell — the grid lines would still show, so the board reads as an
  // empty black screen. DoubleSide renders the quads regardless of winding.
  const cellGeometry = new THREE.PlaneGeometry(0.85, 0.85);
  const headMaterial = new THREE.MeshBasicMaterial({ color: COLORS.head, side: THREE.DoubleSide });
  const bodyMaterial = new THREE.MeshBasicMaterial({ color: COLORS.body, side: THREE.DoubleSide });
  const foodMaterial = new THREE.MeshBasicMaterial({ color: COLORS.food, side: THREE.DoubleSide });

  // 3D blocks: real solids, lit so their depth reads. The head stands taller.
  const bodyBox = new THREE.BoxGeometry(0.82, 0.82, BODY_DEPTH);
  const headBox = new THREE.BoxGeometry(0.86, 0.86, HEAD_DEPTH);
  const foodBox = new THREE.BoxGeometry(0.72, 0.72, FOOD_DEPTH);
  const headMaterial3d = new THREE.MeshStandardMaterial({ color: COLORS.head, roughness: 0.45, metalness: 0.1 });
  const bodyMaterial3d = new THREE.MeshStandardMaterial({ color: COLORS.body, roughness: 0.5, metalness: 0.1 });
  const foodMaterial3d = new THREE.MeshStandardMaterial({ color: COLORS.food, roughness: 0.4, metalness: 0.1 });

  const cells = new THREE.Group();
  scene.add(cells);

  type Role = "head" | "body" | "food";

  function put(pos: Vec2, role: Role, is3D: boolean): void {
    if (is3D) {
      const geom = role === "head" ? headBox : role === "food" ? foodBox : bodyBox;
      const mat = role === "head" ? headMaterial3d : role === "food" ? foodMaterial3d : bodyMaterial3d;
      const depth = role === "head" ? HEAD_DEPTH : role === "food" ? FOOD_DEPTH : BODY_DEPTH;
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(pos.x + 0.5, pos.y + 0.5, depth / 2); // sit the block on the floor (z=0)
      cells.add(mesh);
      return;
    }
    const mat = role === "head" ? headMaterial : role === "food" ? foodMaterial : bodyMaterial;
    const mesh = new THREE.Mesh(cellGeometry, mat);
    mesh.position.set(pos.x + 0.5, pos.y + 0.5, 0);
    cells.add(mesh);
  }

  // --- Power-up token: a billboarded, textured plane ------------------------
  // One reused quad carrying the token texture, kept facing the camera (a
  // billboard) so it reads head-on in both the flat top-down and tilted 3D
  // views. Its texture swaps to match the current token's kind.
  const emojiTextures = new Map<PowerupKind, THREE.Texture>();
  function emojiTextureFor(kind: PowerupKind): THREE.Texture {
    let tex = emojiTextures.get(kind);
    if (tex === undefined) {
      const style = POWERUP_STYLE[kind];
      tex = makeTokenTexture(style.emoji, style.accent);
      emojiTextures.set(kind, tex);
    }
    return tex;
  }
  const tokenGeometry = new THREE.PlaneGeometry(1, 1);
  const powerupMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false, // a floating label — don't let it occlude via the depth buffer
  });
  const powerupMesh = new THREE.Mesh(tokenGeometry, powerupMaterial);
  powerupMesh.visible = false;
  scene.add(powerupMesh);

  // Render-time interpolation state (the prev/cur snake pair). Its *rules* and
  // the per-node lerp/wrap-snap live in the pure scene-model module; the sink
  // only carries the pair across frames and draws what it is handed.
  let interp = initialInterp;

  return {
    render(state: GameState, alpha: number): void {
      // Decide the whole frame as plain data (pure, unit-tested), then place it.
      interp = advanceInterp(interp, state);
      const model = composeScene(state, interp, alpha);
      const is3D = model.camera === "3d";
      const camera = is3D ? camera3d : flatCamera;

      // The frame recolours to signal whether the edge is lethal or wraps.
      wallMaterial.color.setHex(model.wallsLethal ? COLORS.wall : COLORS.wallOff);

      cells.clear();
      put(model.food, "food", is3D);
      model.snake.forEach((segment, index) => {
        put(segment, index === 0 ? "head" : "body", is3D);
      });

      // Power-up token: swap glyph to match the kind, place it over its cell, and
      // billboard it to face the active camera.
      if (model.token !== null) {
        powerupMaterial.map = emojiTextureFor(model.token.kind);
        powerupMaterial.needsUpdate = true;
        const z = is3D ? 0.9 : 0.1; // float above the blocks in 3D, just off the floor in flat
        powerupMesh.position.set(model.token.pos.x + 0.5, model.token.pos.y + 0.5, z);
        powerupMesh.quaternion.copy(camera.quaternion); // billboard toward the viewer
        powerupMesh.visible = true;
      } else {
        powerupMesh.visible = false;
      }

      renderer.render(scene, camera);
    },
    dispose(): void {
      cells.clear();
      for (const bar of wallGroup.children) {
        if (bar instanceof THREE.Mesh) bar.geometry.dispose();
      }
      wallGroup.clear();
      wallMaterial.dispose();
      cellGeometry.dispose();
      bodyBox.dispose();
      headBox.dispose();
      foodBox.dispose();
      gridGeometry.dispose();
      gridMaterial.dispose();
      headMaterial.dispose();
      bodyMaterial.dispose();
      foodMaterial.dispose();
      headMaterial3d.dispose();
      bodyMaterial3d.dispose();
      foodMaterial3d.dispose();
      tokenGeometry.dispose();
      powerupMaterial.dispose();
      for (const tex of emojiTextures.values()) tex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

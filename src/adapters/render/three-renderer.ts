import * as THREE from "three";
import type { GameState, Vec2 } from "../../core/game/types";
import type { Renderer } from "../../core/ports/renderer";

const COLORS = {
  background: 0x0a0a0a,
  grid: 0x1c1c1c,
  wall: 0xdc2626, // danger red — the board edge is lethal, so mark it clearly
  head: 0x7dd3fc,
  body: 0x38bdf8,
  food: 0xf43f5e,
  powerup: 0xfacc15, // amber — the joystick token that unlocks analog steering
} as const;

/** Thickness of the danger border, in world (cell) units. */
const WALL_THICKNESS = 0.18;

/**
 * A deliberately thin three.js renderer. It stands up a genuine 3D scene viewed
 * through an ORTHOGRAPHIC camera, so today it reads as a flat grid — but the
 * z-axis, lighting, and camera moves are all available later without touching
 * game logic. The renderer only composes what the kernel hands it.
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

  // Board spans [0, cols] x [0, rows] in world units. top=0/bottom=rows puts the
  // origin at the top-left, matching the kernel's grid coordinates.
  const camera = new THREE.OrthographicCamera(0, cols, 0, rows, -10, 10);
  camera.position.z = 5;

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
  // the deadly edge reads at a glance. Static geometry: built once, never cleared
  // with the per-frame cells. DoubleSide for the same inverted-camera winding
  // reason the cell meshes need it (see below).
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

  // Shared, reused resources — cells are cheap Mesh objects over these.
  // DoubleSide is load-bearing: the orthographic camera below is built with an
  // inverted Y (top=0, bottom=rows) to get a top-left origin, which flips
  // triangle winding. With the default FrontSide, back-face culling would
  // discard every cell — the grid lines would still show, so the board reads as
  // an empty black screen. DoubleSide renders the quads regardless of winding.
  const cellGeometry = new THREE.PlaneGeometry(0.85, 0.85);
  const headMaterial = new THREE.MeshBasicMaterial({ color: COLORS.head, side: THREE.DoubleSide });
  const bodyMaterial = new THREE.MeshBasicMaterial({ color: COLORS.body, side: THREE.DoubleSide });
  const foodMaterial = new THREE.MeshBasicMaterial({ color: COLORS.food, side: THREE.DoubleSide });
  const powerupMaterial = new THREE.MeshBasicMaterial({ color: COLORS.powerup, side: THREE.DoubleSide });

  const cells = new THREE.Group();
  scene.add(cells);

  function put(pos: Vec2, material: THREE.Material): void {
    const mesh = new THREE.Mesh(cellGeometry, material);
    mesh.position.set(pos.x + 0.5, pos.y + 0.5, 0);
    cells.add(mesh);
  }

  return {
    render(state: GameState): void {
      cells.clear();
      put(state.food, foodMaterial);
      if (state.powerup !== null) put(state.powerup, powerupMaterial);
      state.snake.forEach((segment, index) => {
        put(segment, index === 0 ? headMaterial : bodyMaterial);
      });
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
      gridGeometry.dispose();
      gridMaterial.dispose();
      headMaterial.dispose();
      bodyMaterial.dispose();
      foodMaterial.dispose();
      powerupMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

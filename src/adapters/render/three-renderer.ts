import * as THREE from "three";
import type { GameState, Vec2 } from "../../core/game/types";
import type { Renderer } from "../../core/ports/renderer";

const COLORS = {
  background: 0x0a0a0a,
  grid: 0x1c1c1c,
  head: 0x7dd3fc,
  body: 0x38bdf8,
  food: 0xf43f5e,
} as const;

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

  // Shared, reused resources — cells are cheap Mesh objects over these.
  const cellGeometry = new THREE.PlaneGeometry(0.85, 0.85);
  // The camera inverts Y (top=0, bottom=rows) to put the origin top-left, which
  // flips triangle winding — so the filled cell quads must render double-sided
  // or back-face culling makes them invisible. (Line grids have no winding, so
  // they're unaffected; that's why only the grid showed before this.)
  const headMaterial = new THREE.MeshBasicMaterial({ color: COLORS.head, side: THREE.DoubleSide });
  const bodyMaterial = new THREE.MeshBasicMaterial({ color: COLORS.body, side: THREE.DoubleSide });
  const foodMaterial = new THREE.MeshBasicMaterial({ color: COLORS.food, side: THREE.DoubleSide });

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
      state.snake.forEach((segment, index) => {
        put(segment, index === 0 ? headMaterial : bodyMaterial);
      });
      renderer.render(scene, camera);
    },
    dispose(): void {
      cells.clear();
      cellGeometry.dispose();
      gridGeometry.dispose();
      gridMaterial.dispose();
      headMaterial.dispose();
      bodyMaterial.dispose();
      foodMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

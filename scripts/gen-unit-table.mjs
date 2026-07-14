// One-off code generator. Emits src/core/game/unit-table.ts: a literal table of
// HEADINGS unit vectors indexed by heading angle. This exists so the kernel can
// do analog steering WITHOUT calling Math.sin/cos at runtime.
//
// Why: the JS spec leaves sin/cos/atan2 precision *implementation-defined*, so
// runtime trig on arbitrary angles is not guaranteed bit-identical across
// engines — which would silently corrupt replay determinism (the whole point of
// the pure kernel). Baking the values as source literals sidesteps that: every
// engine parses the same literals to the same doubles. The trig runs once, here,
// at generation time, and never ships.
//
// The four cardinal indices are forced to EXACT integer vectors so that cardinal
// mode is bit-identical to the original integer-grid snake (1.0 axis steps stay
// exact in IEEE-754), keeping the existing kernel tests as a guardrail.
//
//   node scripts/gen-unit-table.mjs > src/core/game/unit-table.ts
//
// Angle convention (y points DOWN, matching the top-left grid origin):
//   index 0   -> ( 1,  0)  east
//   index 64  -> ( 0,  1)  south
//   index 128 -> (-1,  0)  west
//   index 192 -> ( 0, -1)  north
// Increasing index rotates clockwise on screen (east -> south -> west -> north),
// which matches the original RIGHT_OF turn table.

const HEADINGS = 256;

// Exact overrides for the cardinals (cos/sin of 90°-multiples would otherwise
// land on ~6e-17 instead of 0, breaking cardinal exactness).
const EXACT = {
  0: [1, 0],
  64: [0, 1],
  128: [-1, 0],
  192: [0, -1],
};

const rows = [];
for (let h = 0; h < HEADINGS; h++) {
  const exact = EXACT[h];
  const x = exact ? exact[0] : Math.cos((2 * Math.PI * h) / HEADINGS);
  const y = exact ? exact[1] : Math.sin((2 * Math.PI * h) / HEADINGS);
  rows.push(`  { x: ${x}, y: ${y} },`);
}

const out = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/gen-unit-table.mjs > src/core/game/unit-table.ts
//
// A literal table of ${HEADINGS} unit vectors indexed by heading angle. Frozen
// source literals (not runtime trig) so analog steering stays a bit-deterministic
// fold — see scripts/gen-unit-table.mjs for the full rationale. The four cardinal
// indices are exact integers, which keeps cardinal mode identical to the original
// integer-grid snake.

import type { Vec2 } from "./types";

/** Unit vector for each of the ${HEADINGS} discrete headings. y points down. */
export const UNIT: readonly Vec2[] = [
${rows.join("\n")}
];
`;

process.stdout.write(out);

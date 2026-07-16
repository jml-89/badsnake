import { describe, expect, it } from "vitest";
import { axisDelta, torusDist, wrapAxis, wrapVec } from "./torus";

// The one place the wrap seam is reasoned about, so it earns direct coverage.
// Every render/movement/collision fix in this change rests on these being right.

describe("torus geometry", () => {
  describe("axisDelta", () => {
    it("is the plain difference when the axis does not wrap", () => {
      expect(axisDelta(2, 5, 20, false)).toBe(3);
      expect(axisDelta(5, 2, 20, false)).toBe(-3);
      // Even a whole-board gap stays literal with walls on — no folding.
      expect(axisDelta(0.5, 19.5, 20, false)).toBe(19);
    });

    it("takes the short way round when the axis wraps", () => {
      // 19.5 -> 0.5 is +1 across the seam, not -19 back across the board.
      expect(axisDelta(19.5, 0.5, 20, true)).toBeCloseTo(1);
      // 0.5 -> 19.5 is -1 (the mirror of the above).
      expect(axisDelta(0.5, 19.5, 20, true)).toBeCloseTo(-1);
      // A small in-board move is unchanged by the fold.
      expect(axisDelta(5, 6, 20, true)).toBeCloseTo(1);
    });

    it("is antisymmetric across the seam and bounded by half the board", () => {
      for (const [a, b] of [[19.6, 0.2], [0.2, 19.6], [3, 17], [10, 10.4]] as const) {
        expect(Math.abs(axisDelta(a, b, 20, true))).toBeLessThanOrEqual(10);
        expect(axisDelta(a, b, 20, true)).toBeCloseTo(-axisDelta(b, a, 20, true));
      }
    });
  });

  describe("wrapAxis / wrapVec", () => {
    it("folds a coordinate back onto [0, size), keeping the sub-cell offset", () => {
      expect(wrapAxis(20.1, 20)).toBeCloseTo(0.1); // off the right edge -> onto the left
      expect(wrapAxis(-0.1, 20)).toBeCloseTo(19.9); // off the left edge -> onto the right
      expect(wrapAxis(7.3, 20)).toBeCloseTo(7.3); // already in board -> unchanged
    });

    it("wraps both axes of a point", () => {
      expect(wrapVec({ x: 20.2, y: -0.5 }, 20, 20)).toEqual({
        x: wrapAxis(20.2, 20),
        y: wrapAxis(-0.5, 20),
      });
    });
  });

  describe("torusDist", () => {
    it("matches plain Euclidean distance with walls on", () => {
      expect(torusDist({ x: 0.5, y: 5 }, { x: 19.5, y: 5 }, 20, 20, false)).toBeCloseTo(19);
    });

    it("measures the short way across the seam with the edge wrapping", () => {
      // One cell apart through the portal, not 19 across the board.
      expect(torusDist({ x: 0.5, y: 5 }, { x: 19.5, y: 5 }, 20, 20, true)).toBeCloseTo(1);
      // Diagonally across both seams: sqrt(1^2 + 1^2).
      expect(torusDist({ x: 0.5, y: 0.5 }, { x: 19.5, y: 19.5 }, 20, 20, true)).toBeCloseTo(Math.SQRT2);
    });
  });
});

import { describe, expect, it } from "vitest";
import { topScrollEdgeEffect } from "./scroll-edge-effects";

describe("library top edge", () => {
  it.each([
    [-160, 160, "hidden"], // Resting below the native header.
    [-180, 160, "hidden"], // Pull-to-bounce.
    [-159.5, 160, "hidden"], // Fractional layout rounding.
    [-150, 160, "hard"], // Scrolled, before the large title collapses.
    [100, 160, "hard"],
    [0, 0, "hidden"],
  ] as const)("offset %s, inset %s: %s", (offset, inset, effect) => {
    expect(topScrollEdgeEffect(offset, inset)).toBe(effect);
  });
});

import { describe, expect, it } from "vitest";
import {
  getCharacterProfileSheetOptions,
  getCharacterProfileSheetRuntimeOptions,
} from "./character-profile-sheet";

describe("character profile native sheet", () => {
  it("keeps Android on one fixed detent without scroll-edge resizing", () => {
    expect(getCharacterProfileSheetOptions("android")).toMatchObject({
      presentation: "formSheet",
      sheetAllowedDetents: [1],
      sheetInitialDetentIndex: 0,
      sheetExpandsWhenScrolledToEdge: false,
    });
    expect(getCharacterProfileSheetRuntimeOptions("android", true, "#fff")).toMatchObject({
      sheetAllowedDetents: [1],
      sheetExpandsWhenScrolledToEdge: false,
      sheetResizeAnimationEnabled: false,
    });
    expect(getCharacterProfileSheetRuntimeOptions("android", false, "#fff")).toMatchObject({
      sheetAllowedDetents: [1],
      sheetExpandsWhenScrolledToEdge: false,
      sheetResizeAnimationEnabled: false,
    });
  });

  it("preserves the existing adaptive iOS sheet policy", () => {
    expect(getCharacterProfileSheetOptions("ios")).toMatchObject({
      sheetAllowedDetents: [0.78, 1],
      sheetExpandsWhenScrolledToEdge: true,
    });
    expect(getCharacterProfileSheetRuntimeOptions("ios", false, "#fff")).toMatchObject({
      sheetAllowedDetents: "fitToContents",
      sheetExpandsWhenScrolledToEdge: false,
      sheetResizeAnimationEnabled: true,
    });
  });
});

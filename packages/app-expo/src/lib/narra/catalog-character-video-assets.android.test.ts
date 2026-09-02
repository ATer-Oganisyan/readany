import { describe, expect, it } from "vitest";
import { CATALOG_CHARACTER_VIDEO_ASSETS } from "./catalog-character-video-assets.android";

describe("Android catalog character video assets", () => {
  it("does not bundle character MP4 loops", () => {
    expect(CATALOG_CHARACTER_VIDEO_ASSETS).toEqual({});
  });
});

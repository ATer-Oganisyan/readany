import { describe, expect, it } from "vitest";
import { planBookBackgroundWork } from "./book-source-boundary";

describe("book source ownership boundary", () => {
  it("uses backend artifacts for a backend catalog book", () => {
    expect(planBookBackgroundWork("backend-catalog")).toEqual({
      owner: "backend",
      runLocalCharacterAnalysis: false,
      runLocalCoverGeneration: false,
      useServerCharacterManifest: true,
      useServerCover: true,
    });
  });

  it("keeps a local import in the local client pipeline", () => {
    expect(planBookBackgroundWork("local-import")).toEqual({
      owner: "local-client",
      runLocalCharacterAnalysis: true,
      runLocalCoverGeneration: true,
      useServerCharacterManifest: false,
      useServerCover: false,
    });
  });
});

import { describe, expect, it } from "vitest";
import { resolveCoverGenreProfile } from "./cover-genre";

describe("resolveCoverGenreProfile", () => {
  it("prefers explicit EPUB or FB2 genre metadata", () => {
    expect(resolveCoverGenreProfile({ subjects: ["sf_fantasy"] }).id).toBe("fantasy");
    expect(resolveCoverGenreProfile({ subjects: ["Детектив"] }).id).toBe("mystery-thriller");
    expect(resolveCoverGenreProfile({ subjects: ["Манга"] }).id).toBe("manga");
    expect(resolveCoverGenreProfile({ subjects: ["Фанфик"] }).id).toBe("fanfiction");
  });

  it("uses a conservative content fallback when metadata is absent", () => {
    expect(
      resolveCoverGenreProfile({
        title: "Книга",
        description: "Исторический роман о семье на фоне революции.",
      }).id,
    ).toBe("historical-fiction");
  });

  it("does not invent a specific genre from ambiguous text", () => {
    expect(resolveCoverGenreProfile({ title: "Неизвестная книга" }).id).toBe("classic");
  });

  it("gives manga a character-led 1990s cel-anime focal style", () => {
    const profile = resolveCoverGenreProfile({ subjects: ["manga"] });

    expect(profile.artDirection).toContain("1990s cel anime");
    expect(profile.artDirection).toContain("original characters");
  });
});

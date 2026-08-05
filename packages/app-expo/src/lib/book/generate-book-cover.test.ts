import { describe, expect, it, vi } from "vitest";

vi.mock("@/stores/settings-store", () => ({ useSettingsStore: { getState: vi.fn() } }));
vi.mock("@readany/core/utils", () => ({ providerRequiresApiKey: vi.fn(() => true) }));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

import { ART_STYLE, PROMPT_CHAR_LIMIT } from "../narra/art-style";
import { coverPrompt } from "./generate-book-cover";

describe("coverPrompt", () => {
  it("builds a vertical fanart cover prompt with the full style and no painting-era styling", () => {
    const prompt = coverPrompt({
      title: "Анна Каренина",
      author: "Лев Толстой",
      description: "Роман о семье, любви и обществе. ".repeat(40),
      excerpt: "Все счастливые семьи похожи друг на друга. ".repeat(40),
    });

    expect(prompt).toContain("Вертикальная обложка книги");
    expect(prompt).toContain("«Анна Каренина»");
    expect(prompt).toContain(ART_STYLE);
    expect(prompt.endsWith(`Стиль: ${ART_STYLE}.`)).toBe(true);
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
    expect(prompt).not.toContain("Eastern European");
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/stores/settings-store", () => ({ useSettingsStore: { getState: vi.fn() } }));
vi.mock("@readany/core/utils", () => ({ providerRequiresApiKey: vi.fn(() => true) }));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

import coverGenerationConfig from "./cover-generation-config.json";
import { coverPrompt } from "./generate-book-cover";

describe("coverPrompt", () => {
  it("builds the approved GPT Image 2 cover prompt with book context", () => {
    const prompt = coverPrompt({
      title: "Анна Каренина",
      author: "Лев Толстой",
      description: "Роман о семье, любви и давлении общества.",
      subjects: ["literary fiction"],
      accentColor1: "deep crimson red",
    });

    expect(prompt).toContain("Create the complete front-cover artwork");
    expect(prompt).toContain("late modernist editorial design");
    expect(prompt).toContain("two-fifths of the total canvas height");
    expect(prompt).toContain("38–42%");
    expect(prompt).toContain("must never exceed about 45%");
    expect(prompt).toContain("ABSOLUTELY NO TEXT");
    expect(prompt).toContain("“Анна Каренина”");
    expect(prompt).toContain("Лев Толстой");
    expect(prompt).toContain("Роман о семье, любви и давлении общества.");
    expect(prompt).toContain("BOOK GENRE:\nliterary fiction");
    expect(prompt).toContain("psychological and social tension");
    expect(prompt).toContain("SHARED BACKGROUND SYSTEM — IDENTICAL ACROSS ALL GENRES");
    expect(prompt).toContain("deep crimson red");
    expect(prompt).not.toContain("{{BOOK_TITLE}}");
    expect(prompt).not.toContain("{{BACKGROUND_COLOR}}");
    expect(prompt).not.toContain("{{BOOK_GENRE}}");
    expect(prompt).not.toContain("{{GENRE_ART_DIRECTION}}");
  });

  it("uses GPT Image 2 through the configured OpenRouter endpoint", () => {
    expect(coverGenerationConfig.openRouterModel).toBe("openai/gpt-image-2");
  });

  it("fills missing metadata and selects a stable dominant background color", () => {
    const first = coverPrompt({ title: "Неизвестная книга" });
    const second = coverPrompt({ title: "Неизвестная книга" });

    expect(first).toBe(second);
    expect(first).toContain("Unknown author");
    expect(first).toContain("Infer the central idea, mood, symbols and historical context");
    expect(first).toContain("BOOK GENRE:\nclassics / general literature");
    expect(first).toContain("late-modernist paper collage");
    expect(first).not.toMatch(/\{\{[A-Z_]+\}\}/u);
    expect(coverGenerationConfig.backgroundColors.some((color) => first.includes(color))).toBe(
      true,
    );
  });

  it("caps long book descriptions while preserving the complete art direction", () => {
    const prompt = coverPrompt({
      description: "Очень длинное описание содержания книги. ".repeat(30),
      title: "Книга",
    });

    expect(prompt).toContain("CRITICAL OUTPUT RULE");
    expect(prompt.length).toBeLessThan(8_000);
  });

  it("adds a genre-specific direction inferred from content when metadata is absent", () => {
    const prompt = coverPrompt({
      title: "Книга",
      description: "Исторический роман о семье на фоне революции.",
    });

    expect(prompt).toContain("BOOK GENRE:\nhistorical fiction");
    expect(prompt).toContain("era-specific engraved figure");
  });

  it("keeps the background system fixed while allowing a 1990s anime manga illustration", () => {
    const prompt = coverPrompt({ title: "Книга", subjects: ["manga"] });

    expect(prompt).toContain("BOOK GENRE:\nmanga or anime graphic fiction");
    expect(prompt).toContain("1990s cel anime");
    expect(prompt).toContain("Genre variation belongs only inside the compact focal illustration");
  });
});

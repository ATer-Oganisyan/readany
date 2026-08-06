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
      accentColor1: "deep crimson red",
    });

    expect(prompt).toContain("Create the complete front-cover artwork");
    expect(prompt).toContain("late modernist editorial design");
    expect(prompt).toContain("lower two-thirds");
    expect(prompt).toContain("ABSOLUTELY NO TEXT");
    expect(prompt).toContain("“Анна Каренина”");
    expect(prompt).toContain("Лев Толстой");
    expect(prompt).toContain("Роман о семье, любви и давлении общества.");
    expect(prompt).toContain("deep crimson red");
    expect(prompt).not.toContain("{{BOOK_TITLE}}");
    expect(prompt).not.toContain("{{BACKGROUND_COLOR}}");
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
    expect(first).not.toMatch(/\{\{[A-Z_]+\}\}/u);
    expect(coverGenerationConfig.backgroundColors.some((color) => first.includes(color))).toBe(true);
  });

  it("caps long book descriptions while preserving the complete art direction", () => {
    const prompt = coverPrompt({
      description: "Очень длинное описание содержания книги. ".repeat(30),
      title: "Книга",
    });

    expect(prompt).toContain("CRITICAL OUTPUT RULE");
    expect(prompt.length).toBeLessThan(8_000);
  });
});

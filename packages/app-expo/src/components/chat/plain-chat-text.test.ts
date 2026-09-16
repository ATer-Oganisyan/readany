import { describe, expect, it, vi } from "vitest";

vi.mock("react-native-markdown-display", async () => ({
  MarkdownIt: (await import("markdown-it")).default,
}));

import { plainChatText } from "./plain-chat-text";

describe("plain chat answers", () => {
  it("turns headings, emphasis and lists into ordinary paragraphs", () => {
    expect(plainChatText("## Ответ\n\n**Первое** и *второе*.\n\n- Один\n- Два")).toBe(
      "Ответ\n\nПервое и второе.\n\nОдин\n\nДва",
    );
  });

  it("keeps paragraph and verse breaks", () => {
    expect(plainChatText("> Первая строка\n> Вторая строка\n\nЕщё абзац.")).toBe(
      "Первая строка\nВторая строка\n\nЕщё абзац.",
    );
  });

  it("preserves citation markers, punctuation and literal symbols", () => {
    const content = "Йо! 👋 C#, book_id, 2 * 3 = 6; см. [1].";
    expect(plainChatText(content)).toBe(content);
  });

  it("keeps destinations when removing link formatting", () => {
    expect(plainChatText("[Источник](https://example.com/book)")).toBe(
      "Источник (https://example.com/book)",
    );
    expect(plainChatText("<https://example.com/book>")).toBe("https://example.com/book");
  });

  it("preserves code as regular text instead of a formatted block", () => {
    expect(plainChatText("`hello`\n\n```text\nfirst\nsecond\n```")).toBe("hello\n\nfirst\nsecond");
  });
});

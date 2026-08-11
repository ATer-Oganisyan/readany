import { describe, expect, it } from "vitest";
import { normalizeCharacterChatPlaceholder } from "./chat-placeholder";

describe("normalizeCharacterChatPlaceholder", () => {
  it("сохраняет корректно склонённое имя и добавляет многоточие", () => {
    expect(normalizeCharacterChatPlaceholder("Написать Базарову")).toBe("Написать Базарову…");
  });

  it("убирает кавычки и нормализует три точки", () => {
    expect(normalizeCharacterChatPlaceholder("«Написать Анне...»")).toBe("Написать Анне…");
  });

  it("отбрасывает пояснения модели вместо placeholder", () => {
    expect(normalizeCharacterChatPlaceholder("Имя Базаров склоняется как Базарову")).toBeNull();
  });
});

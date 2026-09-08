import { describe, expect, it } from "vitest";
import { normalizeNarraError } from "./errors";

describe("Narra error messages", () => {
  it("separates book extraction failures from generic service failures", () => {
    expect(
      normalizeNarraError(new Error("TypeError: Load failed while extracting a book text sample")),
    ).toMatchObject({
      code: "REQUEST",
      message: "Не удалось прочитать текст книги. Попробуйте снова.",
    });
  });

  it("explains when the character response cannot be used", () => {
    expect(
      normalizeNarraError(new Error("Narra found no characters in the response")),
    ).toMatchObject({
      code: "SERVICE",
      message: "Сервис не распознал персонажей в ответе. Попробуйте снова.",
    });
  });

  it("explains a provider safety rejection", () => {
    expect(
      normalizeNarraError(
        new Error("Kandinsky: запрос или результат отклонён политикой безопасности"),
      ),
    ).toMatchObject({
      code: "SERVICE",
      message: "Сервис отклонил эту сцену по правилам безопасности. Попробуйте другую страницу.",
    });
  });
});

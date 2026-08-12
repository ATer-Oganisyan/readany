import { describe, expect, it } from "vitest";
import { getBookTabLabel } from "./book-tab-label";

describe("getBookTabLabel", () => {
  it("keeps no more than two regular words", () => {
    expect(getBookTabLabel("Двенадцать стульев великого комбинатора")).toBe("Двенадцать стульев…");
  });

  it("allows one short function word alongside two words", () => {
    expect(getBookTabLabel("Золотой ключик, или Приключения Буратино")).toBe(
      "Золотой ключик, или…",
    );
    expect(getBookTabLabel("Война и мир")).toBe("Война и мир");
  });

  it("does not add an ellipsis to a short title", () => {
    expect(getBookTabLabel("Отцы и дети")).toBe("Отцы и дети");
    expect(getBookTabLabel("Ревизор")).toBe("Ревизор");
  });
});

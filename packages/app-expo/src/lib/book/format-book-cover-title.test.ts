import { describe, expect, it } from "vitest";
import { formatBookCoverTitle } from "./format-book-cover-title";

const withoutWordJoiners = (value: string) => value.replaceAll("\u2060", "");

describe("formatBookCoverTitle", () => {
  it.each(["а", "в", "и", "к", "о", "с", "у"])(
    "binds '%s' to the following word",
    (serviceWord) => {
      expect(withoutWordJoiners(formatBookCoverTitle(`${serviceWord} море`))).toBe(
        `${serviceWord}\u00A0море`,
      );
    },
  );

  it("binds consecutive one-letter words", () => {
    expect(withoutWordJoiners(formatBookCoverTitle("и в мире"))).toBe("и\u00A0в\u00A0мире");
  });

  it("preserves ordinary spaces between regular words", () => {
    expect(withoutWordJoiners(formatBookCoverTitle("Война и мир"))).toBe("Война и\u00A0мир");
  });
});

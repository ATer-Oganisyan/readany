import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("book cover typography contract", () => {
  it("keeps title and author within a compact vertical budget", () => {
    const component = readFileSync(
      new URL("../../components/library/book-cover-typography.tsx", import.meta.url),
      "utf8",
    );

    expect(component.match(/numberOfLines=\{2\}/g)).toHaveLength(2);
    expect(component).not.toContain("numberOfLines={6}");
    expect(component).not.toContain("numberOfLines={3}");
    expect(component.match(/ellipsizeMode="tail"/g)).toHaveLength(2);
  });
});

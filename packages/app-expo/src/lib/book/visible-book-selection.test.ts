import { describe, expect, it } from "vitest";
import { areAllVisibleBooksSelected, toggleVisibleBookSelection } from "./visible-book-selection";

describe("selection in a filtered library", () => {
  it("does not confuse equal counts with equal book identities", () => {
    expect(areAllVisibleBooksSelected(new Set(["a"]), ["b"])).toBe(false);
  });

  it("recognizes all visible books even when hidden books are also selected", () => {
    expect(areAllVisibleBooksSelected(new Set(["hidden", "a", "b"]), ["a", "b"])).toBe(true);
  });

  it("does not report an empty filtered view as all selected", () => {
    expect(areAllVisibleBooksSelected(new Set(), [])).toBe(false);
  });

  it("selects the newly visible books without dropping earlier hidden selections", () => {
    const selected = new Set(["a"]);
    expect([...toggleVisibleBookSelection(selected, ["b"])]).toEqual(["a", "b"]);
    expect([...selected]).toEqual(["a"]);
  });

  it("deselects only the visible books and leaves hidden selections alone", () => {
    const selected = new Set(["hidden", "a", "b"]);
    expect([...toggleVisibleBookSelection(selected, ["a", "b"])]).toEqual(["hidden"]);
    expect([...selected]).toEqual(["hidden", "a", "b"]);
  });

  it("keeps selection when the filtered view is empty", () => {
    expect([...toggleVisibleBookSelection(new Set(["hidden"]), [])]).toEqual(["hidden"]);
  });
});

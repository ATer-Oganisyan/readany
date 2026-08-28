import { describe, expect, it } from "vitest";
import { NativeSearchQuery } from "./native-search-query";

describe("native search draft", () => {
  it("retains a Russian/English query through native cancel's synthetic empty change", () => {
    const state = new NativeSearchQuery();
    state.change("Толстой Tolstoy");
    state.cancel();
    expect(state.change("")).toEqual({ query: "Толстой Tolstoy", restore: true });
    expect(state.focus()).toBe("Толстой Tolstoy");
  });

  it("does not suppress an intentional delete after reopening", () => {
    const state = new NativeSearchQuery();
    state.change("Draft");
    state.cancel();
    state.focus();
    expect(state.change("")).toEqual({ query: "", restore: false });
  });

  it("keeps only the current paste/delete sequence without deferred mutations", () => {
    const state = new NativeSearchQuery();
    for (const value of ["a", "весь каталог", "", "exact"]) state.change(value);
    expect(state.get()).toBe("exact");
  });
});

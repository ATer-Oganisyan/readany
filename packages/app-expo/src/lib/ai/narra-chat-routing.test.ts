import { describe, expect, it } from "vitest";
import { resolveNarraChatRoute } from "./narra-chat-routing";

describe("Narra chat retrieval routing", () => {
  it.each(["catalog", "personal"])("uses the server index for an indexed %s book identity", () => {
    expect(
      resolveNarraChatRoute({
        mode: "index-first",
        bookId: "local-book",
        bookEditionId: "edition-id",
      }),
    ).toEqual({
      mode: "index-first",
      initialPath: "index",
      useServerIndex: true,
      useLocalIndex: false,
    });
  });

  it("reuses an existing local book index without regeneration", () => {
    expect(
      resolveNarraChatRoute({
        mode: "index-first",
        bookId: "local-book",
        isLocallyIndexed: true,
      }),
    ).toEqual({
      mode: "index-first",
      initialPath: "index",
      useServerIndex: false,
      useLocalIndex: true,
    });
  });

  it("falls back when a local book has no server edition yet", () => {
    expect(resolveNarraChatRoute({ mode: "index-first", bookId: "local-book" })).toEqual({
      mode: "index-first",
      initialPath: "proxy-fallback",
      useServerIndex: false,
      useLocalIndex: false,
    });
  });

  it("keeps proxy-first independent of index availability", () => {
    expect(
      resolveNarraChatRoute({
        mode: "proxy-first",
        bookId: "local-book",
        bookEditionId: "edition-id",
      }),
    ).toEqual({
      mode: "proxy-first",
      initialPath: "proxy-primary",
      useServerIndex: false,
      useLocalIndex: false,
    });
  });
});

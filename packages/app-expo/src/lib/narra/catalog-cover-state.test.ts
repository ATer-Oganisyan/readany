import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CachedBackendCatalogBook } from "./backend-catalog-cache";
import {
  applyCatalogCoverResult,
  catalogCoverDisplayState,
  retainCatalogCovers,
  retryCatalogCoverDownload,
} from "./catalog-cover-state";

const pending = { hasCover: true, decodedCoverUri: null, failedCoverUri: null };
const cover: NonNullable<CachedBackendCatalogBook["cover"]> = {
  contentHash: "v1",
  mimeType: "image/jpeg",
  byteSize: 42,
  downloadPath: "/fixture",
};
const book = { catalogKey: "book", cover } as CachedBackendCatalogBook;

describe("target catalog cover", () => {
  it("never shows a colored book between metadata, download, and decoding", () => {
    expect(catalogCoverDisplayState(pending)).toBe("loading");
    expect(catalogCoverDisplayState({ ...pending, coverUri: "file:///target" })).toBe("loading");
    expect(
      catalogCoverDisplayState({
        ...pending,
        coverUri: "file:///target",
        decodedCoverUri: "file:///target",
      }),
    ).toBe("image");
  });

  it("does not accept the decoded image of another cover", () => {
    expect(
      catalogCoverDisplayState({
        ...pending,
        coverUri: "file:///new",
        decodedCoverUri: "file:///old",
      }),
    ).toBe("loading");
  });

  it("keeps network and decode failures out of the colored fallback", () => {
    expect(catalogCoverDisplayState({ ...pending, downloadFailed: true })).toBe("error");
    expect(
      catalogCoverDisplayState({
        ...pending,
        coverUri: "file:///bad",
        failedCoverUri: "file:///bad",
      }),
    ).toBe("error");
    expect(catalogCoverDisplayState({ ...pending, downloadFailed: false })).toBe("loading");
    expect(catalogCoverDisplayState({ ...pending, hasCover: false })).toBe("error");
  });

  it("retains downloaded files across a same-cover metadata refresh", () => {
    const current = { ...book, coverUri: "file:///target" };
    expect(retainCatalogCovers([book], [current])[0].coverUri).toBe(current.coverUri);
    const updated = { ...book, cover: { ...cover, contentHash: "v2" } };
    expect(retainCatalogCovers([updated], [current])[0].coverUri).toBeUndefined();
  });

  it("ignores stale successes and failures after the target cover changes", () => {
    const updated = { ...book, cover: { ...cover, contentHash: "v2" } };
    expect(applyCatalogCoverResult([updated], book, "file:///old")[0]).toBe(updated);
    expect(applyCatalogCoverResult([updated], book)[0]).toBe(updated);
    expect(applyCatalogCoverResult([book], book)[0].coverLoadFailed).toBe(true);
    expect(applyCatalogCoverResult([book], book, "file:///target")[0]).toMatchObject({
      coverUri: "file:///target",
      coverLoadFailed: false,
    });
  });

  it("rechecks a failed local URI on retry without accepting an old cover action", () => {
    const failed = { ...book, coverUri: "file:///missing", coverLoadFailed: true };
    expect(retryCatalogCoverDownload([failed], failed)[0]).toMatchObject({
      coverUri: undefined,
      coverLoadFailed: false,
    });
    const newer = { ...book, cover: { ...cover, contentHash: "v2" } };
    expect(retryCatalogCoverDownload([newer], failed)[0]).toBe(newer);
    const ready = { ...book, coverUri: "file:///ready" };
    expect(applyCatalogCoverResult([ready], book)[0]).toBe(ready);
  });

  it("wires readiness and retry through both catalog surfaces without a fade cycle", () => {
    const card = readFileSync(
      new URL("../../components/library/CatalogBookCard.tsx", import.meta.url),
      "utf8",
    );
    expect(card).toContain("catalogCoverDisplayState");
    expect(card).toContain("onLoad=");
    expect(card).toContain("onError=");
    expect(card).toContain("onRetryCover()");
    expect(card).not.toContain("transitionDuration");
    expect(card).not.toContain("loadingCoverColorForTitleAuthor");
    const connected = readFileSync(
      new URL("../../components/library/ConnectedCatalogBookCard.tsx", import.meta.url),
      "utf8",
    );
    expect(connected).toContain("hasCover={!!");
    expect(connected).toContain("useCatalogCover(book)");
    for (const name of [
      "../../components/library/catalog-shelf.tsx",
      "../../screens/LibraryScreen.tsx",
    ]) {
      const source = readFileSync(new URL(name, import.meta.url), "utf8");
      expect(source).toContain("<ConnectedCatalogBookCard");
      expect(source).toContain("onRetryCover=");
    }
  });
});

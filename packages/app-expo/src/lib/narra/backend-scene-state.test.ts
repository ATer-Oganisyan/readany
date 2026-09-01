import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ consumeNarraGatewayResponse: vi.fn() }));
import type { BackendSceneIntent } from "./backend-scene-identity";
import {
  backendSceneForAnchor,
  invalidateBackendScenes,
  migrateBackendSceneState,
  withBackendSceneAsset,
} from "./backend-scene-state";
import { emptyNarraBookState } from "./domain";
import type { NarraBookState, NarraSceneImage } from "./types";

const intent = (sceneKey: string, markupIdentity = "markup"): BackendSceneIntent => ({
  bookEditionId: "edition",
  markupIdentity,
  requestedProgress: 0.4,
  sceneKey,
  slotIndex: 4,
  anchorTextOffset: 400,
});
const scene = (anchor: string, backendScene: BackendSceneIntent): NarraSceneImage => ({
  sourceKey: `page:${anchor}`,
  anchor,
  chapter: "Chapter",
  excerpt: "",
  imageUri: `file:///${anchor}.png`,
  generatedAt: 1,
  backendScene,
});

describe("backend scene state", () => {
  it("stores one asset while preserving every anchor for duplicate scene keys", () => {
    let book = emptyNarraBookState("book");
    book = withBackendSceneAsset(
      book,
      "z-anchor",
      scene("z-anchor", intent("same")),
      intent("same"),
    ).book;
    const duplicate = withBackendSceneAsset(
      book,
      "a-anchor",
      scene("a-anchor", intent("same")),
      intent("same"),
    );
    book = duplicate.book;

    expect(Object.keys(book.scenesByBackendId ?? {})).toHaveLength(1);
    expect(book.sceneAnchorBindings).toEqual({
      "a-anchor": expect.any(String),
      "z-anchor": expect.any(String),
    });
    expect(duplicate.change.removedAnchors).toEqual([]);
    expect(backendSceneForAnchor(book, "a-anchor")?.imageUri).toBe("file:///a-anchor.png");
    expect(backendSceneForAnchor(book, "z-anchor")?.imageUri).toBe("file:///a-anchor.png");
  });

  it("keeps distinct scene keys and markup revisions separate", () => {
    let book = emptyNarraBookState("book");
    for (const [anchor, value] of [
      ["a", intent("one")],
      ["b", intent("two")],
      ["c", intent("one", "markup-v2")],
    ] as const) {
      book = withBackendSceneAsset(book, anchor, scene(anchor, value), value).book;
    }
    expect(Object.keys(book.scenesByBackendId ?? {})).toHaveLength(3);
    expect(Object.keys(book.sceneAnchorBindings ?? {})).toEqual(["a", "b", "c"]);
  });

  it("migrates persisted page-keyed duplicates without touching legacy scenes", () => {
    const same = intent("same");
    const legacy = scene("legacy", { ...same, sceneKey: undefined });
    const earlier = { ...same, anchorTextOffset: 100 };
    const later = { ...same, anchorTextOffset: 800 };
    const persisted: NarraBookState = {
      ...emptyNarraBookState("book"),
      scenes: {
        "page:z": scene("z", earlier),
        "page:a": scene("a", later),
        legacy,
      },
    };
    const migrated = migrateBackendSceneState(persisted);
    expect(Object.keys(migrated.scenesByBackendId ?? {})).toHaveLength(1);
    expect(migrated.sceneAnchorBindings).toEqual({
      a: expect.any(String),
      z: expect.any(String),
    });
    expect(backendSceneForAnchor(migrated, "a")?.imageUri).toBe("file:///z.png");
    expect(backendSceneForAnchor(migrated, "z")?.imageUri).toBe("file:///z.png");
    expect(migrated.scenes.legacy).toBe(legacy);
    expect(migrated.scenes["page:a"]).toBeUndefined();
    expect(migrated.scenes["page:z"]).toBeUndefined();
  });

  it("keeps duplicate bindings already persisted by build 84", () => {
    const same = intent("same");
    const id = JSON.stringify([same.bookEditionId, same.markupIdentity, same.sceneKey]);
    const persisted: NarraBookState = {
      ...emptyNarraBookState("book"),
      scenesByBackendId: { [id]: scene("z", same) },
      sceneAnchorBindings: { a: id, z: id },
      sceneRequests: {
        "page:a": { ...same, anchorTextOffset: 800 },
        "page:z": { ...same, anchorTextOffset: 100 },
      },
    };

    const migrated = migrateBackendSceneState(persisted);

    expect(migrated.sceneAnchorBindings).toEqual({ a: id, z: id });
    expect(Object.keys(migrated.sceneRequests ?? {}).sort()).toEqual(["page:a", "page:z"]);
  });

  it("invalidates backend bindings when edition or markup changes", () => {
    const old = intent("same", "old-markup");
    const book = withBackendSceneAsset(
      emptyNarraBookState("book"),
      "anchor",
      scene("anchor", old),
      old,
    ).book;
    const invalidated = invalidateBackendScenes(book, "edition", "new-markup");
    expect(invalidated.scenesByBackendId).toEqual({});
    expect(invalidated.sceneAnchorBindings).toEqual({});
    expect(invalidated.sceneRequests).toEqual({});
  });
});

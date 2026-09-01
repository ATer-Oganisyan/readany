import { type BackendSceneIntent, backendSceneId } from "./backend-scene-identity";
import { sceneSourceKeyForAnchor } from "./scene-inserts";
import type { NarraBookState, NarraSceneImage } from "./types";

export interface SceneBindingChange {
  backendSceneId?: string;
  canonicalAnchor: string;
  removedAnchors: string[];
}

function anchorForSourceKey(sourceKey: string): string | undefined {
  return sourceKey.startsWith("page:")
    ? sourceKey.slice("page:".length).trim() || undefined
    : undefined;
}

export function withBackendSceneIntent(
  book: NarraBookState,
  anchor: string,
  intent: BackendSceneIntent,
): { book: NarraBookState; change: SceneBindingChange } {
  const id = backendSceneId(intent);
  const sourceKey = sceneSourceKeyForAnchor(anchor);
  if (!id) {
    return {
      book: { ...book, sceneRequests: { ...book.sceneRequests, [sourceKey]: intent } },
      change: { canonicalAnchor: anchor, removedAnchors: [] },
    };
  }

  return {
    book: {
      ...book,
      sceneRequests: { ...book.sceneRequests, [sourceKey]: intent },
      sceneAnchorBindings: { ...book.sceneAnchorBindings, [anchor]: id },
    },
    change: { backendSceneId: id, canonicalAnchor: anchor, removedAnchors: [] },
  };
}

export function withBackendSceneAsset(
  book: NarraBookState,
  anchor: string,
  scene: NarraSceneImage,
  intent: BackendSceneIntent,
): { book: NarraBookState; change: SceneBindingChange } {
  const bound = withBackendSceneIntent(book, anchor, intent);
  const id = bound.change.backendSceneId;
  if (!id) return { book: bound.book, change: bound.change };
  const existing = bound.book.scenesByBackendId?.[id];
  const assetAnchor = existing?.anchor ?? anchor;
  return {
    book: {
      ...bound.book,
      scenesByBackendId: {
        ...bound.book.scenesByBackendId,
        [id]: {
          ...existing,
          ...scene,
          sourceKey: existing?.sourceKey ?? sceneSourceKeyForAnchor(assetAnchor),
          anchor: assetAnchor,
          backendScene: intent,
          backendSceneId: id,
        },
      },
    },
    change: bound.change,
  };
}

export function backendSceneForAnchor(
  book: NarraBookState | undefined,
  anchor: string,
): NarraSceneImage | undefined {
  const id = book?.sceneAnchorBindings?.[anchor];
  return id ? book?.scenesByBackendId?.[id] : undefined;
}

export function migrateBackendSceneState(book: NarraBookState): NarraBookState {
  let migrated = { ...book, scenes: { ...(book.scenes ?? {}) } };
  const groups = new Map<string, NarraSceneImage[]>();
  for (const scene of Object.values(book.scenes ?? {})) {
    const id = scene.anchor ? backendSceneId(scene.backendScene) : undefined;
    if (!id) continue;
    groups.set(id, [...(groups.get(id) ?? []), scene]);
  }

  for (const candidates of groups.values()) {
    const ordered = [...candidates].sort(
      (a, b) =>
        (a.backendScene?.anchorTextOffset ?? Number.MAX_SAFE_INTEGER) -
          (b.backendScene?.anchorTextOffset ?? Number.MAX_SAFE_INTEGER) ||
        (a.generatedAt ?? 0) - (b.generatedAt ?? 0) ||
        (a.anchor ?? "").localeCompare(b.anchor ?? ""),
    );
    const scene = ordered[0];
    const intent = scene.backendScene as BackendSceneIntent;
    const result = withBackendSceneAsset(migrated, scene.anchor as string, scene, intent);
    migrated = result.book;
    for (const duplicate of ordered.slice(1)) {
      migrated = withBackendSceneIntent(
        migrated,
        duplicate.anchor as string,
        duplicate.backendScene as BackendSceneIntent,
      ).book;
    }
    for (const duplicate of candidates) delete migrated.scenes[duplicate.sourceKey];
  }
  for (const [sourceKey, intent] of Object.entries(book.sceneRequests ?? {})) {
    const anchor = anchorForSourceKey(sourceKey);
    if (!anchor || !backendSceneId(intent)) continue;
    migrated = withBackendSceneIntent(migrated, anchor, intent).book;
  }
  return migrated;
}

export function invalidateBackendScenes(
  book: NarraBookState,
  bookEditionId: string,
  markupIdentity?: string,
): NarraBookState {
  const valid = (intent?: BackendSceneIntent) =>
    intent?.bookEditionId === bookEditionId &&
    (!markupIdentity || intent.markupIdentity === markupIdentity);
  const requests = Object.fromEntries(
    Object.entries(book.sceneRequests ?? {}).filter(([, intent]) => valid(intent)),
  );
  const scenesByBackendId = Object.fromEntries(
    Object.entries(book.scenesByBackendId ?? {}).filter(([, scene]) => valid(scene.backendScene)),
  );
  const validIds = new Set(Object.keys(scenesByBackendId));
  const pendingIds = new Set(Object.values(requests).map(backendSceneId).filter(Boolean));
  const sceneAnchorBindings = Object.fromEntries(
    Object.entries(book.sceneAnchorBindings ?? {}).filter(
      ([, id]) => validIds.has(id) || pendingIds.has(id),
    ),
  );
  return { ...book, sceneRequests: requests, scenesByBackendId, sceneAnchorBindings };
}

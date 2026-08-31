import type { BackendBookBinding, BackendBookManifest } from "./backend-book-contract";

export interface BackendSceneIntent {
  bookEditionId: string;
  markupIdentity: string;
  requestedProgress: number;
  sceneKey?: string;
  slotIndex?: number;
  anchorTextOffset?: number;
}

/** Stable client identity for the backend asset. Page/CFI anchors are deliberately excluded. */
export function backendSceneId(intent?: BackendSceneIntent): string | undefined {
  if (!intent?.bookEditionId || !intent.markupIdentity || !intent.sceneKey) return undefined;
  return JSON.stringify([intent.bookEditionId, intent.markupIdentity, intent.sceneKey]);
}

export function backendSceneMarkupIdentity(
  manifest?: BackendBookManifest,
  binding?: BackendBookBinding,
): string {
  return JSON.stringify([
    manifest?.publicationId,
    manifest?.revision,
    manifest?.contentHash,
    binding?.contentSha256,
  ]);
}

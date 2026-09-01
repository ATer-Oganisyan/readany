import { diagnosticErrorReason, recordDiagnostic } from "@/lib/diagnostics/diagnostics";
import { useNarraStore } from "@/stores/narra-store";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { AppState } from "react-native";
import {
  BackendSceneError,
  type BackendSceneIntent,
  backendSceneId,
  requestBackendSceneAt,
  resolveBackendScene,
} from "./backend-scene";
import { saveBackendSceneFile } from "./backend-scene-file";
import { consumeBackendSceneOperation } from "./backend-scene-operations";
import { normalizePersistedNarraMediaUri } from "./media";
import { sceneImageDataUri } from "./scene-inserts";

export async function readSceneDataUri(imageUri: string, signal?: AbortSignal): Promise<string> {
  const uri = normalizePersistedNarraMediaUri(imageUri);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) throw new BackendSceneError("SCENE_ABORTED");
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (!base64) throw new Error("SCENE_EMPTY_LOCAL_FILE");
      return sceneImageDataUri(base64, uri);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 75 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("SCENE_LOCAL_FILE_UNAVAILABLE");
}

/** Invoked by the inline slot action only. Restoring an insert never starts a job. */
export async function generateBackendReaderScene(
  input: {
    bookId: string;
    anchor: string;
    sourceKey: string;
    chapter: string;
    intent: BackendSceneIntent;
    display(anchor: string, dataUri: string): void;
    remove(anchor: string): void;
  },
  signal: AbortSignal,
): Promise<void> {
  const requestId = Crypto.randomUUID();
  let intent = { ...input.intent };
  const persistIntent = () => {
    const change = useNarraStore.getState().setSceneRequest(input.bookId, input.sourceKey, intent);
    for (const anchor of change?.removedAnchors ?? []) input.remove(anchor);
    return change;
  };
  const trace = (stage: string, attempt?: number, code?: number) =>
    recordDiagnostic("scene_request", {
      requestId,
      bookEditionId: intent.bookEditionId,
      sceneKey: intent.sceneKey,
      requestedProgress: intent.requestedProgress,
      stage,
      attempt,
      code,
      state: AppState.currentState,
    });
  try {
    if (signal.aborted) throw new BackendSceneError("SCENE_ABORTED");
    persistIntent();
    let firstSnapshot: Awaited<ReturnType<typeof requestBackendSceneAt>> | undefined;
    if (!intent.sceneKey) {
      firstSnapshot = await requestBackendSceneAt(
        intent.bookEditionId,
        intent.requestedProgress,
        signal,
      );
      intent = {
        ...intent,
        sceneKey: firstSnapshot.sceneKey,
        slotIndex: firstSnapshot.slotIndex,
        anchorTextOffset: firstSnapshot.anchorTextOffset,
      };
      persistIntent();
    }
    const id = backendSceneId(intent);
    if (!id) throw new BackendSceneError("SCENE_INVALID_RESPONSE");
    const discoveredSnapshot = firstSnapshot;
    const shared = await consumeBackendSceneOperation(
      id,
      async (sharedSignal) => {
        let initial = discoveredSnapshot;
        const sharedIntent = { ...intent };
        const result = await resolveBackendScene(
          sharedIntent,
          {
            request: (edition, progress, activeSignal) => {
              if (initial) {
                const snapshot = initial;
                initial = undefined;
                return Promise.resolve(snapshot);
              }
              return requestBackendSceneAt(edition, progress, activeSignal);
            },
            save: (scene, activeSignal) =>
              saveBackendSceneFile(sharedIntent, scene, activeSignal, (bytes, mime) => {
                recordDiagnostic("scene_request", {
                  requestId,
                  stage: "move",
                  bytes,
                  mime,
                  state: AppState.currentState,
                });
              }),
            onSnapshot: (scene) => {
              sharedIntent.sceneKey = scene.sceneKey;
              sharedIntent.slotIndex = scene.slotIndex;
              sharedIntent.anchorTextOffset = scene.anchorTextOffset;
              recordDiagnostic("scene_request", {
                requestId,
                stage: scene.status,
                slotIndex: scene.slotIndex,
                anchorTextOffset: scene.anchorTextOffset,
                sceneKey: scene.sceneKey,
              });
            },
            trace,
          },
          sharedSignal,
        );
        return { ...result, intent: sharedIntent };
      },
      signal,
    );
    if (signal.aborted) throw new BackendSceneError("SCENE_ABORTED");
    intent = shared.intent;
    const change = useNarraStore.getState().setBackendScene(
      input.bookId,
      input.anchor,
      {
        sourceKey: input.sourceKey,
        anchor: input.anchor,
        chapter: input.chapter,
        excerpt: "",
        imageUri: shared.imageUri,
        backendScene: intent,
        generatedAt: Date.now(),
      },
      intent,
    );
    for (const anchor of change.removedAnchors) input.remove(anchor);
    trace("store");
    if (change.canonicalAnchor !== input.anchor) return;
    const dataUri = await readSceneDataUri(shared.imageUri, signal);
    if (signal.aborted) throw new BackendSceneError("SCENE_ABORTED");
    input.display(change.canonicalAnchor, dataUri);
    trace("webview");
  } catch (error) {
    recordDiagnostic("scene_request", {
      requestId,
      stage: signal.aborted ? "aborted" : "failed",
      reason: diagnosticErrorReason(error),
      failure: error instanceof BackendSceneError ? error.code : "SCENE_IO_OR_NETWORK",
      state: AppState.currentState,
    });
    throw error;
  }
}

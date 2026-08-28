import { diagnosticErrorReason, recordDiagnostic } from "@/lib/diagnostics/diagnostics";
import { useNarraStore } from "@/stores/narra-store";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { AppState } from "react-native";
import {
  BackendSceneError,
  type BackendSceneIntent,
  requestBackendSceneAt,
  resolveBackendScene,
} from "./backend-scene";
import { saveBackendSceneFile } from "./backend-scene-file";
import { normalizePersistedNarraMediaUri } from "./media";
import { sceneImageDataUri } from "./scene-inserts";

export async function readSceneDataUri(imageUri: string): Promise<string> {
  const uri = normalizePersistedNarraMediaUri(imageUri);
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (!base64) throw new Error("SCENE_EMPTY_LOCAL_FILE");
  return sceneImageDataUri(base64, uri);
}

/** Invoked by the inline slot action only. Restoring an insert never starts a job. */
export async function generateBackendReaderScene(
  input: {
    bookId: string;
    anchor: string;
    sourceKey: string;
    chapter: string;
    intent: BackendSceneIntent;
    display(dataUri: string): void;
  },
  signal: AbortSignal,
): Promise<void> {
  const requestId = Crypto.randomUUID();
  let intent = { ...input.intent };
  const persistIntent = () =>
    useNarraStore.getState().setSceneRequest(input.bookId, input.sourceKey, intent);
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
    const result = await resolveBackendScene(
      intent,
      {
        request: requestBackendSceneAt,
        save: (scene, activeSignal) =>
          saveBackendSceneFile(intent, scene, activeSignal, (bytes, mime) => {
            recordDiagnostic("scene_request", {
              requestId,
              stage: "move",
              bytes,
              mime,
              state: AppState.currentState,
            });
          }),
        onSnapshot: (scene) => {
          intent = { ...intent, sceneKey: scene.sceneKey };
          persistIntent();
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
      signal,
    );
    if (signal.aborted) throw new BackendSceneError("SCENE_ABORTED");
    useNarraStore.getState().setScene(input.bookId, {
      sourceKey: input.sourceKey,
      anchor: input.anchor,
      chapter: input.chapter,
      excerpt: "",
      imageUri: result.imageUri,
      backendScene: intent,
      generatedAt: Date.now(),
    });
    trace("store");
    const dataUri = await readSceneDataUri(result.imageUri);
    if (signal.aborted) throw new BackendSceneError("SCENE_ABORTED");
    input.display(dataUri);
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

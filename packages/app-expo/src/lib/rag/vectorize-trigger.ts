import { useLibraryStore } from "@/stores/library-store";
import { useVectorModelStore } from "@/stores/vector-model-store";
import { triggerVectorizeBook as coreTriggerVectorizeBook } from "@readany/core/rag";
import type {
  ChapterData,
  VectorizeStatusCallback,
  VectorizeTriggerConfig,
} from "@readany/core/rag";

export type { VectorizeStatusCallback };

export async function triggerVectorizeBook(
  bookId: string,
  _filePath: string,
  chapters: ChapterData[],
  onProgress?: VectorizeStatusCallback,
): Promise<void> {
  const vmState = useVectorModelStore.getState();

  // Auto-fix: if user has remote model configured but mode is still "builtin", switch to remote
  const selectedRemoteModel = vmState.getSelectedVectorModel();
  if (vmState.vectorModelMode === "builtin" && selectedRemoteModel) {
    console.log("[Vectorize] Auto-switching to remote mode since remote model is configured");
    vmState.setVectorModelMode("remote");
  }

  if (vmState.vectorModelMode === "builtin") {
    throw new Error(
      "移动端不支持本地向量模型，请在「设置 → 向量模型」中配置远程 API（如硅基流动、OpenAI 等）。",
    );
  }

  // 1. Build configuration for the core pipeline
  const config: VectorizeTriggerConfig = {
    vectorModelEnabled: vmState.vectorModelEnabled,
    vectorModelMode: vmState.vectorModelMode,
    selectedBuiltinModelId: vmState.selectedBuiltinModelId,
    remoteModel: (() => {
      const selected = vmState.getSelectedVectorModel();
      if (!selected) return null;
      return {
        url: selected.url,
        apiKey: selected.apiKey,
        modelId: selected.modelId,
      };
    })(),
  };

  // 2. Build callbacks for state updates
  const callbacks = {
    onBookUpdate: useLibraryStore.getState().updateBook,
  };

  // 3. Delegate to core vectorization pipeline which does the chunking & embedding
  await coreTriggerVectorizeBook(bookId, chapters, config, callbacks, onProgress);
}

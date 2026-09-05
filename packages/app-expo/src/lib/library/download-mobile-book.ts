import { toast } from "@/lib/notifications";
import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
import type { TFunction } from "i18next";

type Progress = { downloaded: number; total: number };
type Outcome = "ok" | "not-found" | "error" | "not-configured" | "missing-password";
interface DownloadOptions {
  loadBooks: () => Promise<void>;
  onProgress?: (progress: Progress) => void;
}

const activeDownloads = new Map<
  string,
  { promise: Promise<Outcome>; listeners: Set<(progress: Progress) => void> }
>();

async function enqueueVectorization(book: Book): Promise<void> {
  const { useVectorModelStore } = await import("@/stores/vector-model-store");
  const state = useVectorModelStore.getState();
  if (!state.autoVectorizeOnImport || !state.vectorModelEnabled || !state.hasVectorCapability())
    return;
  const { queueBookForAutoVectorize } = await import("@/lib/rag/auto-vectorize-book");
  await queueBookForAutoVectorize({ ...book, syncStatus: "local" });
}

async function performDownload(book: Book, options: DownloadOptions): Promise<Outcome> {
  let restoreRemote = false;
  try {
    const { useSyncStore } = await import("@readany/core/stores/sync-store");
    const { downloadBookFile } = await import("@readany/core/sync");
    const { updateBook } = await import("@readany/core/db/database");
    const { config } = useSyncStore.getState();
    if (!config) return "not-configured";
    const secretKey = config.type === "webdav" ? "sync_webdav_password" : "sync_s3_secret_key";
    const password = await getPlatformService().kvGetItem(secretKey);
    if (!password) return "missing-password";

    await updateBook(book.id, { syncStatus: "downloading" });
    restoreRemote = true;
    await options.loadBooks();
    const { createSyncBackend } = await import("@readany/core/sync/sync-backend-factory");
    const backend = createSyncBackend(config, password);
    const outcome = await downloadBookFile(backend, book.id, book.filePath, options.onProgress);
    // Core transfer has committed its final local/remote status. A UI refresh
    // failure after success must not turn the downloaded book back into remote.
    restoreRemote = false;
    await options.loadBooks();
    if (outcome === "ok") {
      // AI enrichment must not delay opening a successfully downloaded file.
      void enqueueVectorization(book).catch((error) => {
        console.warn(`[BookDownload] Auto-vectorize enqueue failed for ${book.id}:`, error);
      });
    }
    return outcome;
  } catch (error) {
    if (restoreRemote) {
      try {
        const { updateBook } = await import("@readany/core/db/database");
        await updateBook(book.id, { syncStatus: "remote" });
        await options.loadBooks();
      } catch (recoveryError) {
        console.warn("[BookDownload] Failed to restore retryable status:", recoveryError);
      }
    }
    console.error("[BookDownload] Download failed:", error);
    return "error";
  }
}

/** All mobile entry points share one transfer per book, including progress and recovery. */
export async function downloadMobileBook(book: Book, options: DownloadOptions): Promise<Outcome> {
  let operation = activeDownloads.get(book.id);
  if (!operation) {
    const listeners = new Set<(progress: Progress) => void>();
    const promise = performDownload(book, {
      loadBooks: options.loadBooks,
      onProgress: (progress) => {
        for (const listener of listeners) listener(progress);
      },
    });
    operation = { promise, listeners };
    activeDownloads.set(book.id, operation);
  }
  if (options.onProgress) operation.listeners.add(options.onProgress);
  try {
    return await operation.promise;
  } finally {
    if (options.onProgress) operation.listeners.delete(options.onProgress);
    if (activeDownloads.get(book.id) === operation) activeDownloads.delete(book.id);
  }
}

export function reportMobileBookDownloadFailure(
  outcome: Exclude<Outcome, "ok">,
  t: TFunction,
): void {
  const description =
    outcome === "not-configured"
      ? t("library.syncNotConfigured", "Сначала настройте синхронизацию")
      : outcome === "missing-password"
        ? t("library.passwordNotFound", "Пароль синхронизации не найден")
        : outcome === "not-found"
          ? t(
              "library.downloadNotFound",
              "На удалённом устройстве нет файла книги. Синхронизируйте её ещё раз или импортируйте заново.",
            )
          : t("library.downloadFailed", "Не удалось скачать книгу. Попробуйте ещё раз.");
  toast.error(t("common.error", "Ошибка"), { description });
}

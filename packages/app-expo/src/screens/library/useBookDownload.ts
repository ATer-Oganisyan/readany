import { toast } from "@/lib/notifications";
import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

interface UseBookDownloadOptions {
  loadBooks: () => Promise<void>;
  onSuccess: (bookId: string) => void;
}

export function useBookDownload({ loadBooks, onSuccess }: UseBookDownloadOptions) {
  const { t } = useTranslation();
  const [downloadingBookId, setDownloadingBookId] = useState<string | null>(null);
  const [downloadingBookTitle, setDownloadingBookTitle] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<{
    downloaded: number;
    total: number;
  } | null>(null);

  const downloadBook = useCallback(
    async (book: Book) => {
      const bookTitle = book.meta.title || "未知书籍";
      setDownloadingBookId(book.id);
      setDownloadingBookTitle(bookTitle);
      setDownloadProgress(null);

      try {
        const { useSyncStore } = await import("@readany/core/stores/sync-store");
        const { downloadBookFile } = await import("@readany/core/sync");
        const { updateBook } = await import("@readany/core/db/database");

        const syncStore = useSyncStore.getState();
        if (!syncStore.config) {
          setDownloadingBookId(null);
          setDownloadingBookTitle("");
          setDownloadProgress(null);
          toast.error(t("common.error", "Ошибка"), {
            description: t("library.syncNotConfigured", "Сначала настройте синхронизацию"),
          });
          return false;
        }

        const platform = getPlatformService();
        const secretKey =
          syncStore.config.type === "webdav" ? "sync_webdav_password" : "sync_s3_secret_key";
        const password = await platform.kvGetItem(secretKey);
        if (!password) {
          setDownloadingBookId(null);
          setDownloadingBookTitle("");
          setDownloadProgress(null);
          toast.error(t("common.error", "Ошибка"), {
            description: t("library.passwordNotFound", "Пароль синхронизации не найден"),
          });
          return false;
        }

        await updateBook(book.id, { syncStatus: "downloading" });
        await loadBooks();

        const { createSyncBackend } = await import("@readany/core/sync/sync-backend-factory");
        const backend = createSyncBackend(syncStore.config, password);

        const outcome = await downloadBookFile(backend, book.id, book.filePath, (progress) => {
          setDownloadProgress(progress);
        });
        await loadBooks();

        if (outcome === "not-found") {
          toast.error(t("common.error", "Ошибка"), {
            description: t(
              "library.downloadNotFound",
              "На удалённом устройстве нет файла книги. Синхронизируйте её ещё раз или импортируйте заново.",
            ),
          });
          return false;
        }
        if (outcome === "error") {
          toast.error(t("common.error", "Ошибка"), {
            description: t(
              "library.downloadFailed",
              "Не удалось скачать книгу. Попробуйте ещё раз.",
            ),
          });
          return false;
        }

        console.log(`[useBookDownload] Book ${book.id} downloaded successfully`);
        const { useVectorModelStore } = await import("@/stores/vector-model-store");
        const vmState = useVectorModelStore.getState();
        if (
          vmState.autoVectorizeOnImport &&
          vmState.vectorModelEnabled &&
          vmState.hasVectorCapability()
        ) {
          const { queueBookForAutoVectorize } = await import("@/lib/rag/auto-vectorize-book");
          queueBookForAutoVectorize({ ...book, syncStatus: "local" }).catch((err) => {
            console.warn(`[useBookDownload] Auto-vectorize enqueue failed for ${book.id}:`, err);
          });
        }
        onSuccess(book.id);
        return true;
      } catch (err) {
        console.error("Download failed:", err);
        toast.error(t("common.error", "Ошибка"), {
          description: t("library.downloadFailed", "Не удалось скачать книгу. Попробуйте ещё раз."),
        });
        return false;
      } finally {
        setDownloadingBookId(null);
        setDownloadingBookTitle("");
        setDownloadProgress(null);
      }
    },
    [loadBooks, onSuccess, t],
  );

  return { downloadingBookId, downloadingBookTitle, downloadProgress, downloadBook };
}

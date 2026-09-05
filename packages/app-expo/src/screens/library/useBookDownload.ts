import {
  downloadMobileBook,
  reportMobileBookDownloadFailure,
} from "@/lib/library/download-mobile-book";
import type { Book } from "@readany/core/types";
import { useCallback, useRef, useState } from "react";
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
  const downloadInFlight = useRef(false);

  const downloadBook = useCallback(
    async (book: Book) => {
      if (downloadInFlight.current) return false;
      downloadInFlight.current = true;
      const bookTitle = book.meta.title || "未知书籍";
      setDownloadingBookId(book.id);
      setDownloadingBookTitle(bookTitle);
      setDownloadProgress(null);

      try {
        const outcome = await downloadMobileBook(book, {
          loadBooks,
          onProgress: setDownloadProgress,
        });
        if (outcome !== "ok") {
          reportMobileBookDownloadFailure(outcome, t);
          return false;
        }
        onSuccess(book.id);
        return true;
      } catch (err) {
        console.error("Download failed:", err);
        reportMobileBookDownloadFailure("error", t);
        return false;
      } finally {
        downloadInFlight.current = false;
        setDownloadingBookId(null);
        setDownloadingBookTitle("");
        setDownloadProgress(null);
      }
    },
    [loadBooks, onSuccess, t],
  );

  return { downloadingBookId, downloadingBookTitle, downloadProgress, downloadBook };
}

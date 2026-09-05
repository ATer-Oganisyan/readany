import { withGatewayConsumer } from "@/lib/ai/narra-gateway-consumer";
import { bookImportFormat, bookImportPickerTypes } from "@/lib/book/import-format";
import { toast } from "@/lib/notifications";
import { useLibraryStore } from "@/stores";
import type { Book, ImportBooksResult } from "@readany/core";
import { getBookImportFailureCode } from "@readany/core/import/import-errors";
import { getPlatformService } from "@readany/core/services";
import { generateId } from "@readany/core/utils";
import * as DocumentPicker from "expo-document-picker";
import { File as ExpoFile, Paths } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Platform } from "react-native";
import ReadAnyNativeControls from "../../modules/native-controls";

function getUrlImportFilename(url: URL): string {
  const rawName = decodeURIComponent(url.pathname.split("/").pop() || "").trim();
  const safeName = rawName.replace(/[\\/:*?"<>|\[\]{}#%&]/g, "_");
  try {
    bookImportFormat(safeName);
  } catch {
    throw new Error("unsupported-url");
  }

  return safeName;
}

interface UseBookImportActionsOptions {
  onImportComplete?: (importedCount: number) => void;
  onOpenImportedBook?: (book: Book) => void | Promise<void>;
}

type ImportToastId = string | number;

const RESULT_TOAST_DURATION_MS = 4000;
const MAX_FAILURE_DETAILS = 10;
// Match the existing native-tab clearance in CenteredEmptyState. Sonner already
// accounts for the safe-area inset; only the tab bar itself needs extra space.
const URL_IMPORT_TOAST_OPTIONS = {
  position: "bottom-center" as const,
  styles: {
    toastContainer: {
      marginBottom: Platform.OS === "android" ? 80 : Platform.OS === "ios" ? 49 : 0,
    },
  },
};

const IMPORT_FAILURE_KEYS = {
  UNSUPPORTED_FORMAT: "library.importFailureUnsupported",
  EMPTY_SOURCE: "library.importFailureEmpty",
  CORRUPT_SOURCE: "library.importFailureCorrupt",
  SOURCE_TOO_LARGE: "library.importFailureTooLarge",
  SOURCE_UNAVAILABLE: "library.importFailureSourceUnavailable",
  STORAGE_FAILED: "library.importFailureStorage",
  CONTENT_BLOCKED: "library.importFailureBlocked",
  UNKNOWN: "library.importFailureUnknown",
} as const;

function importFailureKey(code?: string): string {
  return code && Object.hasOwn(IMPORT_FAILURE_KEYS, code)
    ? IMPORT_FAILURE_KEYS[code as keyof typeof IMPORT_FAILURE_KEYS]
    : IMPORT_FAILURE_KEYS.UNKNOWN;
}

function importFailureDetail(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/** Ficbook has a deadline per request, not for an entire multi-chapter book. */
function waitForFicbookDownload<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? Object.assign(new Error("Import cancelled"), { name: "AbortError" }));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    // Observe late rejection/completion even if the user has already cancelled.
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function useBookImportActions({
  onImportComplete,
  onOpenImportedBook,
}: UseBookImportActionsOptions = {}) {
  const { t } = useTranslation();
  const importBooks = useLibraryStore((state) => state.importBooks);
  const [isPickingImport, setIsPickingImport] = useState(false);
  const [isUrlImporting, setIsUrlImporting] = useState(false);
  const localImportInFlightRef = useRef(false);
  const urlImportInFlightRef = useRef(false);
  const urlDownloadControllerRef = useRef<AbortController | null>(null);
  const urlLoadingToastRef = useRef<ImportToastId | undefined>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      urlDownloadControllerRef.current?.abort();
      // Saving is atomic and must finish, but its screen no longer owns feedback.
      if (urlLoadingToastRef.current !== undefined) {
        toast.dismiss(urlLoadingToastRef.current);
        urlLoadingToastRef.current = undefined;
      }
    };
  }, []);

  const showImportSummary = useCallback(
    (summary: ImportBooksResult, toastId?: ImportToastId) => {
      if (!mountedRef.current) return;
      const refreshed = Math.min(
        summary.imported.length,
        Math.max(0, Math.trunc(summary.refreshedCount || 0)),
      );
      const added = summary.imported.length - refreshed;
      const singleAddedBook =
        summary.imported.length === 1 &&
        added === 1 &&
        summary.skippedDuplicates.length === 0 &&
        summary.failures.length === 0
          ? summary.imported[0]
          : undefined;
      onImportComplete?.(summary.imported.length);
      const description = t("library.importResultSummaryWithUpdates", {
        imported: added,
        refreshed,
        skipped: summary.skippedDuplicates.length,
        failed: summary.failures.length,
      });
      // File imports receive an ID from success(); URL imports reuse their loading ID.
      // Keep this closure bound to its own result, including after a newer import.
      let resultToastId = toastId;
      const toastOptions = {
        ...(toastId !== undefined ? URL_IMPORT_TOAST_OPTIONS : {}),
        description,
        // Global Toaster hides technical descriptions; import counts are user-facing.
        styles: {
          ...(toastId !== undefined ? URL_IMPORT_TOAST_OPTIONS.styles : {}),
          description: { display: "flex" as const },
        },
        duration:
          summary.failures.length || (singleAddedBook && onOpenImportedBook)
            ? 8000
            : RESULT_TOAST_DURATION_MS,
        id: toastId,
        ...(summary.failures.length
          ? {
              action: {
                label: t("library.importResultDetails", "Подробнее"),
                onClick: () => {
                  const lines = summary.failures
                    .slice(0, MAX_FAILURE_DETAILS)
                    .map(({ name, code }) => {
                      const leaf = name.replace(/\\/g, "/").split("/").pop() || "";
                      const filename =
                        leaf && !/[<>]/.test(leaf)
                          ? importFailureDetail(leaf, 160)
                          : t("library.importFailureFile");
                      return `${filename}\n${t(importFailureKey(code))}`;
                    });
                  const remaining = summary.failures.length - lines.length;
                  if (remaining > 0)
                    lines.push(t("library.importResultMoreFailures", { count: remaining }));
                  Alert.alert(
                    t("library.importResultFailedFiles", "Не добавленные файлы"),
                    lines.join("\n\n"),
                    [{ text: t("common.close", "Закрыть") }],
                  );
                },
              },
            }
          : singleAddedBook && onOpenImportedBook
            ? {
                action: {
                  label: t("library.importResultOpen", "Открыть"),
                  onClick: () => {
                    if (!mountedRef.current) return;
                    if (resultToastId !== undefined) toast.dismiss(resultToastId);
                    return onOpenImportedBook(singleAddedBook);
                  },
                },
              }
            : {}),
      };
      if (summary.failures.length > 0) {
        if (summary.imported.length > 0 || summary.skippedDuplicates.length > 0) {
          toast.warning(
            added > 0
              ? t("library.importResultPartialSuccess", "Часть книг добавлена")
              : t("library.importResultPartialFailure", "Некоторые файлы не добавлены"),
            toastOptions,
          );
        } else {
          toast.error(t("library.importResultFailed", "Добавление не удалось"), toastOptions);
        }
      } else if (summary.imported.length > 0) {
        resultToastId = toast.success(
          added === 0
            ? t("library.importResultUpdated", "Библиотека обновлена")
            : t("library.importResultReadyToRead", "Импорт завершён. Можно читать"),
          toastOptions,
        );
      } else {
        toast.warning(
          summary.skippedDuplicates.length > 0
            ? t("library.importResultAlreadyInLibrary", "Уже в библиотеке")
            : t("library.importResultEmpty", "Ничего не добавлено"),
          toastOptions,
        );
      }
    },
    [onImportComplete, onOpenImportedBook, t],
  );

  const handleLocalImport = useCallback(async () => {
    if (localImportInFlightRef.current) return;
    localImportInFlightRef.current = true;
    setIsPickingImport(true);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: bookImportPickerTypes(Platform.OS),
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (!mountedRef.current || result.canceled || !result.assets || result.assets.length === 0)
        return;

      const files = result.assets.map((asset) => ({ uri: asset.uri, name: asset.name }));
      const summary = await importBooks(files);
      showImportSummary(summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Different document picking in progress")) {
        console.error("Import failed:", error);
        if (!mountedRef.current) return;
        toast.error(t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"), {
          description: t(importFailureKey(getBookImportFailureCode(error))),
          styles: { description: { display: "flex" } },
          duration: RESULT_TOAST_DURATION_MS,
        });
      }
    } finally {
      localImportInFlightRef.current = false;
      if (mountedRef.current) setIsPickingImport(false);
    }
  }, [importBooks, showImportSummary, t]);

  const handleUrlImport = useCallback(
    async (rawValue: string) => {
      const value = rawValue.trim();
      let temporaryFile: ExpoFile | null = null;
      let loadingToastId: string | number | undefined;
      const controller = new AbortController();
      const removeTemporaryFile = () => {
        try {
          if (temporaryFile?.exists) temporaryFile.delete();
        } catch (error) {
          // Cache cleanup must not turn a saved book into an import failure.
          console.warn("[BookImport][url] Temporary file cleanup failed:", error);
        }
      };

      try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          throw new Error("invalid-url");
        }

        setIsUrlImporting(true);
        urlDownloadControllerRef.current = controller;
        const cancelAction = {
          label: t("common.cancel", "Отмена"),
          onClick: () => {
            // A stale toast callback must not promise rollback of an atomic save.
            if (urlDownloadControllerRef.current === controller) controller.abort();
          },
        };
        loadingToastId = toast.loading(t("library.downloading", "Загрузка книги…"), {
          ...URL_IMPORT_TOAST_OPTIONS,
          description: t(
            "library.importSourceUrlDesc",
            "Скачиваем книгу по ссылке. Это может занять несколько секунд.",
          ),
          duration: Number.POSITIVE_INFINITY,
          action: cancelAction,
        });
        urlLoadingToastRef.current = loadingToastId;

        const timeoutMs = 135_000;
        const ficbook = await withGatewayConsumer(
          (scope) => scope.wait(import("@/lib/book/import-ficbook")),
          { timeoutMs, signal: controller.signal },
        );
        let source: { uri: string; name: string };
        if (ficbook.parseFicbookUrl(value)) {
          const fanfic = await waitForFicbookDownload(
            ficbook.importFicbookFromUrl(value, {
              signal: controller.signal,
              onProgress: ({ completed, total }) => {
                if (
                  !mountedRef.current ||
                  controller.signal.aborted ||
                  urlDownloadControllerRef.current !== controller
                )
                  return;
                toast.loading(t("library.downloading", "Загрузка книги…"), {
                  ...URL_IMPORT_TOAST_OPTIONS,
                  styles: {
                    ...URL_IMPORT_TOAST_OPTIONS.styles,
                    description: { display: "flex" },
                  },
                  id: loadingToastId,
                  description: `${completed}/${total}`,
                  duration: Number.POSITIVE_INFINITY,
                  action: cancelAction,
                });
              },
            }),
            controller.signal,
          );
          if (controller.signal.aborted) {
            if (loadingToastId !== undefined) toast.dismiss(loadingToastId);
            return;
          }
          temporaryFile = new ExpoFile(Paths.cache, `readany-ficbook-${generateId()}.epub`);
          temporaryFile.write(fanfic.epubBytes);
          source = { uri: temporaryFile.uri, name: fanfic.fileName };
        } else {
          source = await withGatewayConsumer(
            async (scope) => {
              const fileName = getUrlImportFilename(url);
              temporaryFile = new ExpoFile(Paths.cache, `readany-url-${generateId()}-${fileName}`);
              const destination = temporaryFile.uri;
              const platform = getPlatformService();
              if (!platform.downloadFile) throw new Error("File downloader unavailable");
              await scope.wait(
                platform
                  .downloadFile(url.toString(), destination, {
                    signal: scope.signal,
                    timeoutMs,
                  })
                  .finally(() => {
                    // Also clean a late provider write if its transport ignored abort.
                    if (scope.signal.aborted) removeTemporaryFile();
                  }),
              );
              scope.throwIfAborted();
              return { uri: destination, name: fileName };
            },
            { timeoutMs, signal: controller.signal },
          );
        }
        if (controller.signal.aborted) {
          if (loadingToastId !== undefined) toast.dismiss(loadingToastId);
          return;
        }
        urlDownloadControllerRef.current = null;
        toast.loading(t("library.importing", "Добавление книги…"), {
          ...URL_IMPORT_TOAST_OPTIONS,
          id: loadingToastId,
          duration: Number.POSITIVE_INFINITY,
          action: undefined,
          description: undefined,
        });
        const summary = await importBooks([source]);
        showImportSummary(summary, loadingToastId);
      } catch (error) {
        if (controller.signal.aborted) {
          if (loadingToastId !== undefined) toast.dismiss(loadingToastId);
          return;
        }
        console.info("[BookImport][url] Failed:", error);
        if (!mountedRef.current) return;
        const errorCode = error instanceof Error ? error.message : "";
        const importCode = getBookImportFailureCode(error);
        const message = importCode
          ? t(importFailureKey(importCode))
          : errorCode === "ficbook-blocked"
            ? t(
                "library.importSourceUrlFicbookBlocked",
                "Фикбук временно блокирует автоматический доступ — попробуйте позже.",
              )
            : errorCode === "ficbook-not-found"
              ? t(
                  "library.importSourceUrlFicbookNotFound",
                  "Фанфик по этой ссылке не найден. Проверьте адрес и попробуйте снова.",
                )
              : errorCode === "ficbook-timeout"
                ? t(
                    "library.importSourceUrlFicbookTimeout",
                    "Фикбук не ответил вовремя. Попробуйте добавить книгу ещё раз позже.",
                  )
                : errorCode === "unsupported-url"
                  ? t(
                      "library.importSourceUrlUnsupported",
                      "Нужна прямая ссылка на файл EPUB, PDF, TXT или другого поддерживаемого формата — либо ссылка на фанфик Фикбука.",
                    )
                  : t(
                      "library.importSourceUrlError",
                      "Проверьте ссылку и подключение к интернету, затем попробуйте снова.",
                    );
        toast.error(t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"), {
          ...URL_IMPORT_TOAST_OPTIONS,
          styles: {
            ...URL_IMPORT_TOAST_OPTIONS.styles,
            description: { display: "flex" },
          },
          description: message,
          duration: RESULT_TOAST_DURATION_MS,
          id: loadingToastId,
          action: undefined,
        });
      } finally {
        if (urlLoadingToastRef.current === loadingToastId) urlLoadingToastRef.current = undefined;
        if (urlDownloadControllerRef.current === controller)
          urlDownloadControllerRef.current = null;
        if (mountedRef.current) setIsUrlImporting(false);
        removeTemporaryFile();
      }
    },
    [importBooks, showImportSummary, t],
  );

  const handleOpenUrlImport = useCallback(async () => {
    if (urlImportInFlightRef.current) return;
    urlImportInFlightRef.current = true;
    try {
      const value = await ReadAnyNativeControls.promptForText(
        t("library.importSourceUrlTitle", "Ссылка на книгу"),
        t("library.importSourceUrlDesc", "Вставьте ссылку на файл книги или на фанфик Фикбука."),
        t("library.importSourceUrlPlaceholder", "Ссылка на файл или фанфик Фикбука"),
        t("common.cancel", "Отмена"),
        t("library.importSourceUrlSubmit", "Добавить"),
      );
      if (mountedRef.current && value?.trim()) {
        await handleUrlImport(value);
      }
    } catch (error) {
      console.error("Native URL prompt failed:", error);
      if (!mountedRef.current) return;
      toast.error(t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"), {
        description: t("library.importSourceUrlError", "Проверьте ссылку и попробуйте снова."),
      });
    } finally {
      urlImportInFlightRef.current = false;
    }
  }, [handleUrlImport, t]);

  const handleOpenImportSources = useCallback(() => {
    Alert.alert(t("library.importFirst", "Добавить книгу"), undefined, [
      {
        text: t("library.importSourceUrl", "Найти по ссылке"),
        onPress: () => void handleOpenUrlImport(),
      },
      {
        text: t("library.importSourceLocal", "Выбрать файл"),
        onPress: () => void handleLocalImport(),
      },
      { text: t("common.cancel", "Отмена"), style: "cancel" },
    ]);
  }, [handleLocalImport, handleOpenUrlImport, t]);

  return {
    isPickingImport,
    isUrlImporting,
    handleLocalImport,
    handleOpenImportSources,
    handleOpenUrlImport,
  };
}

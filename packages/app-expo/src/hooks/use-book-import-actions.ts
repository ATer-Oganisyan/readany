import { MishanaerIcon } from "@/components/ui/MishanaerIcon";
import { toast } from "@/lib/notifications";
import { useLibraryStore } from "@/stores";
import { useTheme } from "@/styles/ThemeContext";
import type { ImportBooksResult } from "@readany/core";
import * as DocumentPicker from "expo-document-picker";
import { File as ExpoFile, Paths } from "expo-file-system";
import { createElement, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import ReadAnyNativeControls from "../../modules/native-controls";

const URL_IMPORT_EXTENSIONS = new Set([
  "epub",
  "pdf",
  "mobi",
  "azw",
  "azw3",
  "cbz",
  "cbr",
  "fb2",
  "fbz",
  "txt",
  "umd",
]);

function getUrlImportFilename(url: URL): string {
  const rawName = decodeURIComponent(url.pathname.split("/").pop() || "").trim();
  const safeName = rawName.replace(/[\\/:*?"<>|\[\]{}#%&]/g, "_");
  const extension = safeName.split(".").pop()?.toLowerCase();

  if (!safeName || !extension || !URL_IMPORT_EXTENSIONS.has(extension)) {
    throw new Error("unsupported-url");
  }

  return safeName;
}

interface UseBookImportActionsOptions {
  onImportComplete?: (importedCount: number) => void;
}

type ImportToastId = string | number;

const RESULT_TOAST_DURATION_MS = 4000;

export function useBookImportActions({ onImportComplete }: UseBookImportActionsOptions = {}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const importBooks = useLibraryStore((state) => state.importBooks);
  const [isPickingImport, setIsPickingImport] = useState(false);
  const [isUrlImporting, setIsUrlImporting] = useState(false);
  const localImportInFlightRef = useRef(false);

  const showImportSummary = useCallback(
    (summary: ImportBooksResult, toastId?: ImportToastId, announceEnrichment = false) => {
      onImportComplete?.(summary.imported.length);
      const description = t("library.importResultSummary", {
        imported: summary.imported.length,
        skipped: summary.skippedDuplicates.length,
        failed: summary.failures.length,
      });
      const toastOptions = {
        description,
        duration: RESULT_TOAST_DURATION_MS,
        id: toastId,
      };
      if (summary.failures.length > 0) {
        toast.error(
          t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"),
          toastOptions,
        );
      } else if (summary.imported.length > 0) {
        toast.success(
          announceEnrichment
            ? t(
                "library.localImportEnrichmentPending",
                "Готово! Скоро добавим обложку и\u00A0персонажей",
              )
            : t("common.success", "Книга добавлена"),
          announceEnrichment
            ? {
                ...toastOptions,
                icon: createElement(MishanaerIcon, {
                  name: "magic-wand",
                  variant: "filled",
                  size: 24,
                  color: colors.primary60,
                }),
              }
            : toastOptions,
        );
      } else {
        toast.warning(t("library.importSourceUrlErrorTitle", "Книга не добавлена"), toastOptions);
      }
    },
    [colors.primary60, onImportComplete, t],
  );

  const handleLocalImport = useCallback(async () => {
    if (localImportInFlightRef.current) return;
    localImportInFlightRef.current = true;
    setIsPickingImport(true);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/epub+zip",
          "application/pdf",
          "application/x-mobipocket-ebook",
          "application/vnd.amazon.ebook",
          "application/vnd.comicbook+zip",
          "application/x-fictionbook+xml",
          "text/plain",
          "application/octet-stream",
        ],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const files = result.assets.map((asset) => ({ uri: asset.uri, name: asset.name }));
      const summary = await importBooks(files);
      showImportSummary(summary, undefined, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Different document picking in progress")) {
        console.error("Import failed:", error);
      }
    } finally {
      localImportInFlightRef.current = false;
      setIsPickingImport(false);
    }
  }, [importBooks, showImportSummary]);

  const handleUrlImport = useCallback(
    async (rawValue: string) => {
      const value = rawValue.trim();
      let temporaryFile: ExpoFile | null = null;
      let loadingToastId: string | number | undefined;

      try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          throw new Error("invalid-url");
        }

        setIsUrlImporting(true);
        loadingToastId = toast.loading(t("library.downloading", "Загрузка книги…"), {
          description: t(
            "library.importSourceUrlDesc",
            "Скачиваем книгу по ссылке. Это может занять несколько секунд.",
          ),
          duration: Number.POSITIVE_INFINITY,
        });

        // Фанфики Фикбука качаются и собираются в EPUB отдельным модулем (P11).
        const ficbook = await import("@/lib/book/import-ficbook");
        if (ficbook.parseFicbookUrl(value)) {
          const fanfic = await ficbook.importFicbookFromUrl(value);
          temporaryFile = new ExpoFile(Paths.cache, `readany-ficbook-${Date.now()}.epub`);
          if (temporaryFile.exists) {
            temporaryFile.delete();
          }
          temporaryFile.write(fanfic.epubBytes);
          const ficbookSummary = await importBooks([
            { uri: temporaryFile.uri, name: fanfic.fileName },
          ]);
          showImportSummary(ficbookSummary, loadingToastId);
          return;
        }

        const fileName = getUrlImportFilename(url);
        temporaryFile = new ExpoFile(Paths.cache, `readany-url-${Date.now()}-${fileName}`);
        const downloadedFile = await ExpoFile.downloadFileAsync(url.toString(), temporaryFile, {
          idempotent: true,
        });
        const summary = await importBooks([{ uri: downloadedFile.uri, name: fileName }]);
        showImportSummary(summary, loadingToastId);
      } catch (error) {
        console.info("[BookImport][url] Failed:", error);
        const errorCode = error instanceof Error ? error.message : "";
        const message =
          errorCode === "ficbook-blocked"
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
          description: message,
          duration: RESULT_TOAST_DURATION_MS,
          id: loadingToastId,
        });
      } finally {
        setIsUrlImporting(false);
        if (temporaryFile?.exists) {
          temporaryFile.delete();
        }
      }
    },
    [importBooks, showImportSummary, t],
  );

  const handleOpenUrlImport = useCallback(async () => {
    try {
      const value = await ReadAnyNativeControls.promptForText(
        t("library.importSourceUrlTitle", "Ссылка на книгу"),
        t("library.importSourceUrlDesc", "Вставьте ссылку на файл книги или на фанфик Фикбука."),
        t("library.importSourceUrlPlaceholder", "Ссылка на файл или фанфик Фикбука"),
        t("common.cancel", "Отмена"),
        t("library.importSourceUrlSubmit", "Добавить"),
      );
      if (value?.trim()) {
        await handleUrlImport(value);
      }
    } catch (error) {
      console.error("Native URL prompt failed:", error);
      toast.error(t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"), {
        description: t("library.importSourceUrlError", "Проверьте ссылку и попробуйте снова."),
      });
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

import { useLibraryStore } from "@/stores";
import type { ImportBooksResult } from "@readany/core";
import * as DocumentPicker from "expo-document-picker";
import { File as ExpoFile, Paths } from "expo-file-system";
import { useCallback, useRef, useState } from "react";
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

export function useBookImportActions({ onImportComplete }: UseBookImportActionsOptions = {}) {
  const { t } = useTranslation();
  const importBooks = useLibraryStore((state) => state.importBooks);
  const [isPickingImport, setIsPickingImport] = useState(false);
  const [isUrlImporting, setIsUrlImporting] = useState(false);
  const localImportInFlightRef = useRef(false);

  const showImportSummary = useCallback(
    (summary: ImportBooksResult) => {
      onImportComplete?.(summary.imported.length);
      if (summary.imported.length === 0 || summary.failures.length > 0) {
        Alert.alert(
          t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"),
          t("library.importResultSummary", {
            imported: summary.imported.length,
            skipped: summary.skippedDuplicates.length,
            failed: summary.failures.length,
          }),
        );
      }
    },
    [onImportComplete, t],
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
      showImportSummary(summary);
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

      try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          throw new Error("invalid-url");
        }

        // Фанфики Фикбука качаются и собираются в EPUB отдельным модулем (P11).
        const ficbook = await import("@/lib/book/import-ficbook");
        if (ficbook.parseFicbookUrl(value)) {
          setIsUrlImporting(true);
          const fanfic = await ficbook.importFicbookFromUrl(value);
          temporaryFile = new ExpoFile(Paths.cache, `readany-ficbook-${Date.now()}.epub`);
          if (temporaryFile.exists) {
            temporaryFile.delete();
          }
          temporaryFile.write(fanfic.epubBytes);
          const ficbookSummary = await importBooks([
            { uri: temporaryFile.uri, name: fanfic.fileName },
          ]);
          showImportSummary(ficbookSummary);
          return;
        }

        const fileName = getUrlImportFilename(url);
        temporaryFile = new ExpoFile(Paths.cache, `readany-url-${Date.now()}-${fileName}`);
        setIsUrlImporting(true);
        const downloadedFile = await ExpoFile.downloadFileAsync(url.toString(), temporaryFile, {
          idempotent: true,
        });
        const summary = await importBooks([{ uri: downloadedFile.uri, name: fileName }]);
        showImportSummary(summary);
      } catch (error) {
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
              : errorCode === "unsupported-url"
                ? t(
                    "library.importSourceUrlUnsupported",
                    "Нужна прямая ссылка на файл EPUB, PDF, TXT или другого поддерживаемого формата — либо ссылка на фанфик Фикбука.",
                  )
                : t(
                    "library.importSourceUrlError",
                    "Проверьте ссылку и подключение к интернету, затем попробуйте снова.",
                  );
        Alert.alert(
          t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"),
          message,
        );
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
      Alert.alert(
        t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"),
        t("library.importSourceUrlError", "Проверьте ссылку и попробуйте снова."),
      );
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

import { MishanaerIcon } from "@/components/ui/MishanaerIcon";
import { toast } from "@/lib/notifications";
import { useLibraryStore } from "@/stores";
import { useTheme } from "@/styles/ThemeContext";
import type { ImportBooksResult } from "@readany/core";
import * as DocumentPicker from "expo-document-picker";
import { createElement, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

interface UseBookImportActionsOptions {
  onImportComplete?: (importedCount: number) => void;
}

type ImportToastId = string | number;

const RESULT_TOAST_DURATION_MS = 3000;

/** Тост с результатом импорта — общий для пикера и для книг, пришедших из шеринга. */
export function useImportSummaryToast(onImportComplete?: (importedCount: number) => void) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return useCallback(
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
                "Готовим обложку и персонажей —\nэто займёт до 15 минут",
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
}

export function useBookImportActions({ onImportComplete }: UseBookImportActionsOptions = {}) {
  const { t } = useTranslation();
  const importBooks = useLibraryStore((state) => state.importBooks);
  const [isPickingImport, setIsPickingImport] = useState(false);
  const localImportInFlightRef = useRef(false);
  const showImportSummary = useImportSummaryToast(onImportComplete);

  const handleLocalImport = useCallback(async () => {
    if (localImportInFlightRef.current) return;
    localImportInFlightRef.current = true;
    setIsPickingImport(true);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        // Document providers label FB2/FBZ inconsistently (XML, ZIP or binary).
        // Validate the filename in the importer instead of hiding valid files here.
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const files = result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        size: asset.size,
      }));
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

  const handleOpenImportSources = useCallback(() => {
    Alert.alert(t("library.importFirst", "Добавить книгу"), undefined, [
      {
        text: t("library.importSourceLocal", "Выбрать файл"),
        onPress: () => void handleLocalImport(),
      },
      { text: t("common.cancel", "Отмена"), style: "cancel" },
    ]);
  }, [handleLocalImport, t]);

  return {
    isPickingImport,
    handleLocalImport,
    handleOpenImportSources,
  };
}

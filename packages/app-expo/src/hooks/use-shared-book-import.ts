import { resolveSharedBookName } from "@/lib/book/shared-import-name";
import { toast } from "@/lib/notifications";
import { useLibraryStore } from "@/stores";
import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Linking } from "react-native";
import { useImportSummaryToast } from "./use-book-import-actions";

/**
 * Книга, открытая в Narra из другого приложения («Скопировать в Narra» на iOS,
 * «Открыть с помощью» на Android), импортируется так же, как выбранная пикером.
 */
export function useSharedBookImport() {
  const { t } = useTranslation();
  const importBooks = useLibraryStore((state) => state.importBooks);
  const showImportSummary = useImportSummaryToast();
  const handledRef = useRef(new Set<string>());

  useEffect(() => {
    const handle = async (uri?: string | null) => {
      if (!uri || !/^(file|content):/i.test(uri) || handledRef.current.has(uri)) return;
      handledRef.current.add(uri);
      try {
        // content:// читается только через copyAsync, поэтому сигнатуру смотрим уже в копии.
        const destination = `${FileSystem.cacheDirectory}shared-${Date.now()}`;
        await FileSystem.copyAsync({ from: uri, to: destination });
        const head = await FileSystem.readAsStringAsync(destination, {
          encoding: "base64",
          position: 0,
          length: 8,
        });
        const name = resolveSharedBookName(uri, head);
        showImportSummary(await importBooks([{ uri: destination, name }]), undefined, true);
      } catch (error) {
        console.error("[sharedImport] Failed to import shared book:", error);
        toast.error(t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"));
      }
    };

    void Linking.getInitialURL().then(handle);
    const subscription = Linking.addEventListener("url", (event) => void handle(event.url));
    return () => subscription.remove();
  }, [importBooks, showImportSummary, t]);
}

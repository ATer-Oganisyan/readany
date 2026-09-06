import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/notifications";

export function useBatchBookDelete(
  removeBook: (id: string) => Promise<void>,
  onSettled: (failedIds: string[], requestedIds: string[]) => void,
) {
  const { t } = useTranslation();
  const mounted = useRef(true);
  const locked = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const requestDelete = useCallback(
    (selected: Iterable<string>, options?: { canApplySelectionResult?: () => boolean }) => {
      const ids = [...new Set(selected)];
      if (!mounted.current || locked.current || !ids.length) return;
      locked.current = true;
      let confirmed = false;
      const unlock = () => {
        if (!confirmed) locked.current = false;
      };
      try {
        Alert.alert(
          t("common.confirm"),
          t("library.batchDeleteConfirm", { count: ids.length }),
          [
            { text: t("common.cancel"), style: "cancel", onPress: unlock },
            {
              text: t("common.delete"),
              style: "destructive",
              onPress: async () => {
                if (confirmed || !mounted.current) return;
                confirmed = true;
                setIsDeleting(true);
                const failed: string[] = [];
                let deleted = 0;
                try {
                  for (const id of ids) {
                    // Confirmation covers the whole batch; leaving is not cancellation.
                    try {
                      await removeBook(id);
                      deleted++;
                    } catch {
                      failed.push(id);
                    }
                  }
                  if (!mounted.current) return;
                  // A confirmed operation survives leaving selection mode, but
                  // its result must not replace a newer selection session.
                  if (options?.canApplySelectionResult?.() !== false) onSettled(failed, ids);
                  const toastOptions = {
                    description: t("library.batchDeleteResult", { deleted, failed: failed.length }),
                    styles: { description: { display: "flex" as const } },
                    duration: failed.length ? 8000 : 4000,
                  };
                  if (failed.length) toast.error(t("library.batchDeleteFailed"), toastOptions);
                  else toast.success(t("library.batchDeleteDone"), toastOptions);
                } finally {
                  locked.current = false;
                  if (mounted.current) setIsDeleting(false);
                }
              },
            },
          ],
          { cancelable: true, onDismiss: unlock },
        );
      } catch {
        locked.current = false;
        if (mounted.current) toast.error(t("library.batchDeleteFailed"));
      }
    },
    [removeBook, onSettled, t],
  );
  return { requestDelete, isDeleting };
}

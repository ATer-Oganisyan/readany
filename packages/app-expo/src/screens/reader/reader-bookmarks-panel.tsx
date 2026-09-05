import { Trash2Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Typography";
import { useAnnotationStore } from "@/stores";
import { useTheme } from "@/styles/theme";
import { spacingPixels } from "@deslop/primitives";
import { getBookmarks } from "@readany/core/db/database";
import type { Bookmark } from "@readany/core/types";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";

export function ReaderBookmarksPanel({
  bookId,
  onSelectCfi,
}: {
  bookId: string;
  onSelectCfi: (cfi: string) => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const removeBookmark = useAnnotationStore((state) => state.removeBookmark);
  const committedBookmarks = useAnnotationStore((state) => state.bookmarks);
  const [rows, setRows] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const deleting = useRef(new Set<string>());
  const active = useRef<string | null>(bookId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new book starts a separate visible pending state.
  useEffect(() => {
    // Refreshing committed rows must not hide an unrelated in-flight deletion.
    setPending(null);
  }, [bookId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry and committed store writes intentionally refresh the persisted list.
  useEffect(() => {
    active.current = bookId;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getBookmarks(bookId)
      .then((result) => {
        if (!cancelled) setRows(result.filter((row) => row.bookId === bookId));
      })
      .catch(() => {
        if (!cancelled) setError("load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      active.current = null;
    };
  }, [bookId, reload, committedBookmarks]);
  const remove = async (id: string) => {
    if (deleting.current.has(id)) return;
    deleting.current.add(id);
    setPending(id);
    setError(null);
    try {
      await removeBookmark(id);
      if (active.current === bookId) setRows((current) => current.filter((row) => row.id !== id));
    } catch {
      if (active.current === bookId) setError("delete");
    } finally {
      deleting.current.delete(id);
      if (active.current !== null) setPending((current) => (current === id ? null : current));
    }
  };
  return (
    <View style={{ flex: 1 }}>
      {error && (
        <View style={{ padding: spacingPixels[16], gap: spacingPixels[8] }}>
          <Text selectable accessibilityRole="alert">
            {t(error === "load" ? "bookmarks.loadFailed" : "bookmarks.saveFailed")}
          </Text>
          {error === "load" && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setReload((value) => value + 1)}
              style={{ minHeight: 48, justifyContent: "center" }}
            >
              <Text style={{ color: colors.primary }}>{t("common.retry", "Повторить")}</Text>
            </Pressable>
          )}
        </View>
      )}
      {loading ? (
        <ActivityIndicator accessibilityLabel={t("common.loading", "Загрузка")} />
      ) : (
        <FlatList
          testID="reader-bookmarks-list"
          contentInsetAdjustmentBehavior="automatic"
          data={rows.filter((row) => row.bookId === bookId)}
          keyExtractor={(row) => row.id}
          contentContainerStyle={{ padding: spacingPixels[16], gap: spacingPixels[8], flexGrow: 1 }}
          ListEmptyComponent={
            error ? null : (
              <View style={{ gap: spacingPixels[8] }}>
                <Text>{t("bookmarks.empty")}</Text>
                <Text style={{ color: colors.mutedForeground }}>
                  {t("bookmarks.mobileEmptyHint")}
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Pressable
                accessibilityRole="button"
                testID={`bookmark-open-${item.id}`}
                onPress={() => onSelectCfi(item.cfi)}
                style={{
                  flex: 1,
                  minHeight: 64,
                  paddingVertical: spacingPixels[12],
                  gap: spacingPixels[8],
                }}
              >
                <Text numberOfLines={2}>
                  {item.label || item.chapterTitle || t("bookmarks.title")}
                </Text>
                {!!item.label && !!item.chapterTitle && (
                  <Text numberOfLines={1} style={{ color: colors.mutedForeground }}>
                    {item.chapterTitle}
                  </Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("bookmarks.remove")}
                accessibilityState={{ disabled: pending !== null, busy: pending === item.id }}
                disabled={pending !== null}
                testID={`bookmark-delete-${item.id}`}
                onPress={() => void remove(item.id)}
                style={{ width: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}
              >
                {pending === item.id ? (
                  <ActivityIndicator />
                ) : (
                  <Trash2Icon size={18} color={colors.mutedForeground} />
                )}
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

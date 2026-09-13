import { SystemSheetZoomDestination } from "@/components/navigation/SystemSheetZoomDestination";
import { BookCoverTypography } from "@/components/library/book-cover-typography";
import { BookSurface } from "@/components/library/perspective-book";
import { useResolvedAssetUris } from "@/components/library/use-resolved-asset-uris";
import { NativeCharacterDetailsCells } from "@/components/narra/NativeCharacterDetailsCells";
import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { useCoverSheetColors } from "@/hooks/use-cover-sheet-colors";
import { foregroundForBackground } from "@/styles/foreground-for-background";
import { useBackendCatalog } from "@/hooks/use-backend-catalog";
import { shouldRenderCoverTypography } from "@/lib/book/cover-display";
import { generatedCoverTextTone } from "@/lib/book/cover-text-contrast";
import { contentHtmlToParagraphs } from "@/lib/book/import-ficbook";
import { loadingCoverColorForTitleAuthor } from "@/lib/book/loading-cover-placeholder";
import { findBundledCatalogBookByTitle } from "@/lib/catalog/bundled-books";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import { findReadableLibraryBookForCatalogBook } from "@/lib/narra/backend-catalog-library";
import { getCatalogBookWithCover } from "@/lib/narra/catalog-cover-store";
import { toast } from "@/lib/notifications";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores/library-store";
import {
  bodyTypography,
  spacing,
  title24Typography,
  titleFontFamily,
  useTheme,
} from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBookDownload } from "./library/useBookDownload";
import { useResolvedCovers } from "./notes/useResolvedCovers";

const onDownloaded = () => {};

export function BookDetailsScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, "BookDetails">) {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { bookId, catalogBook } = route.params;
  const book = useLibraryStore((state) =>
    bookId
      ? state.books.find((item) => item.id === bookId)
      : catalogBook
        ? findReadableLibraryBookForCatalogBook(catalogBook, state.books)
        : undefined,
  );
  const loadBooks = useLibraryStore((state) => state.loadBooks);
  const catalog = useBackendCatalog(false).catalog;
  const { downloadBook, downloadProgress } = useBookDownload({
    loadBooks,
    onSuccess: onDownloaded,
  });
  const opening = useRef(false);
  const [busy, setBusy] = useState(false);
  const title = book?.meta.title ?? catalogBook?.title ?? "";
  const author = book?.meta.author ?? catalogBook?.author ?? "";
  const bundled = findBundledCatalogBookByTitle(title);
  const coverAssetModule = bundled?.coverAssetModule;
  const assets = useMemo(() => (coverAssetModule ? [coverAssetModule] : []), [coverAssetModule]);
  const assetUris = useResolvedAssetUris(assets);
  const localBookId = book?.id;
  const localCoverUrl = book?.meta.coverUrl;
  const covers = useMemo(
    () => (localBookId ? [{ bookId: localBookId, coverUrl: localCoverUrl }] : []),
    [localBookId, localCoverUrl],
  );
  const resolvedCovers = useResolvedCovers(covers);
  const coverUri =
    route.params.coverUri ||
    (catalogBook && getCatalogBookWithCover(catalogBook).coverUri) ||
    (book && resolvedCovers.get(book.id)) ||
    (bundled && assetUris.get(bundled.coverAssetModule));
  const [failedCover, setFailedCover] = useState<string>();
  const visibleCover = coverUri && coverUri !== failedCover ? coverUri : undefined;
  const coverColors = useCoverSheetColors(visibleCover);
  const backgroundColor = coverColors?.color ?? colors.background;
  const foreground = coverColors ? foregroundForBackground(backgroundColor) : undefined;
  useLayoutEffect(() => {
    if (Platform.OS === "ios") navigation.setOptions({ contentStyle: { backgroundColor } });
  }, [backgroundColor, navigation]);

  const description = contentHtmlToParagraphs(
    (book?.meta.description || catalogBook?.description || "").replace(/<\/(?:p|div)>/gi, "\n"),
  ).join("\n\n");
  const genres =
    catalogBook?.genres.flatMap((id) => {
      const genre = catalog.genres.find((item) => item.id === id);
      return genre ? [i18n.resolvedLanguage?.startsWith("ru") ? genre.labelRu : genre.labelEn] : [];
    }) ??
    book?.meta.subjects ??
    [];
  const items = [
    {
      key: "description",
      label: t("bookDetails.about", "О книге"),
      value: description || t("bookDetails.noDescription", "Описание пока не добавлено."),
    },
  ];
  if (genres.length)
    items.push({ key: "genre", label: t("bookDetails.genre", "Жанр"), value: genres.join(", ") });

  const read = async () => {
    if (opening.current || !navigation.isFocused()) return;
    opening.current = true;
    setBusy(true);
    try {
      // Resolve again: an import or sync may have finished while this sheet was open.
      const books = useLibraryStore.getState().books;
      const current = bookId
        ? books.find((item) => item.id === bookId)
        : catalogBook
          ? findReadableLibraryBookForCatalogBook(catalogBook, books)
          : undefined;
      if (current) {
        if (current.syncStatus === "remote" && !(await downloadBook(current))) return;
        if (navigation.isFocused())
          await openMobileBook({ bookId: current.id, navigation, t, replace: true });
      } else if (catalogBook) {
        navigation.replace("Reader", {
          bookId: "",
          catalogBook: getCatalogBookWithCover(catalogBook),
        });
      } else {
        toast.error(t("bookDetails.unavailable", "Книга больше не доступна в библиотеке"));
      }
    } catch (error) {
      console.warn("[BookDetails] Failed to open book:", error);
      toast.error(t("bookDetails.openFailed", "Не удалось открыть книгу. Попробуйте ещё раз."));
    } finally {
      opening.current = false;
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[
        styles.content,
        { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.lg },
      ]}
    >
      <View style={styles.header}>
        <SystemSheetZoomDestination
          sourceId={route.params.sourceId}
          expanded={false}
          alignToContent
          style={{ width: 180, height: 264 }}
        >
          <BookSurface
            width={180}
            height={264}
            borderRadius={8}
            showShadow
            cover={
              <View
                style={{
                  flex: 1,
                  backgroundColor: loadingCoverColorForTitleAuthor({ title, author }),
                }}
              >
                {visibleCover ? (
                  <Image
                    source={{ uri: visibleCover }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                    onError={() => setFailedCover(visibleCover)}
                  />
                ) : null}
                <BookCoverTypography
                  title={title}
                  author={author}
                  width={180}
                  coverUri={visibleCover}
                  showText={
                    !visibleCover ||
                    !!catalogBook ||
                    shouldRenderCoverTypography(book?.id ?? "", book?.meta.coverUrl)
                  }
                  textTone={
                    visibleCover
                      ? (bundled?.coverTextTone ?? generatedCoverTextTone({ title, author }))
                      : "light"
                  }
                />
              </View>
            }
          />
        </SystemSheetZoomDestination>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: foreground?.primary ?? colors.foreground }]}
        >
          {title}
        </Text>
        {!!author && (
          <Text style={[styles.author, { color: foreground?.secondary ?? colors.mutedForeground }]}>
            {author}
          </Text>
        )}
      </View>
      <View style={styles.action}>
        <NativeButton
          testID="book-details-read"
          label={busy ? t("bookDetails.opening", "Открываем…") : t("bookDetails.read", "Читать")}
          size="large"
          icon="play"
          iconOnly
          nativeAppearance
          variant="glass"
          colorScheme={(foreground?.isDark ?? isDark) ? "dark" : "light"}
          style={{ alignSelf: "center" }}
          disabled={busy || (!book && !catalogBook)}
          loading={busy}
          onPress={() => {
            void read();
          }}
        />
        {downloadProgress && downloadProgress.total > 0 ? (
          <Text style={[styles.author, { color: foreground?.secondary ?? colors.mutedForeground }]}>
            {Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)}%
          </Text>
        ) : null}
      </View>
      <NativeCharacterDetailsCells
        topSpacing={spacing.xxl}
        items={items}
        isDark={foreground?.isDark ?? isDark}
        cellBackgroundColor={colors.card}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // The native grabber ends 11 pt below the sheet edge; leave 24 pt after it.
  content: { paddingTop: 11 + spacing.xxl },
  header: { alignItems: "center", paddingHorizontal: spacing.xl },
  title: {
    ...title24Typography,
    fontFamily: titleFontFamily,
    textAlign: "center",
    marginTop: spacing.xxl,
  },
  author: { ...bodyTypography, textAlign: "center", marginTop: spacing.sm },
  action: { marginHorizontal: spacing.xl, marginTop: spacing.xxl + spacing.xs },
});

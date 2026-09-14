import { BookCoverTypography } from "@/components/library/book-cover-typography";
import { BookSurface } from "@/components/library/perspective-book";
import { shouldRenderCoverTypography } from "@/lib/book/cover-display";
import { generatedCoverTextTone } from "@/lib/book/cover-text-contrast";
import { loadingCoverColorForTitleAuthor } from "@/lib/book/loading-cover-placeholder";
import { findBundledCatalogBookByTitle } from "@/lib/catalog/bundled-books";
import { useLibraryStore } from "@/stores/library-store";
import { useTTSStore } from "@/stores/tts-store";
import { radius } from "@/styles/theme";
import { Image, StyleSheet, View } from "react-native";
import { useAudiobookArtwork } from "./use-audiobook-artwork";

/** The catalog's book surface and typography, including in the mini-player. */
export function AudiobookCover({
  height,
  showShadow = height > 48,
}: { height: number; showShadow?: boolean }) {
  const bookId = useTTSStore((s) => s.currentBookId);
  const title = useTTSStore((s) => s.currentBookTitle);
  const artwork = useAudiobookArtwork();
  const book = useLibraryStore((s) => s.books.find((item) => item.id === bookId));
  const bundled = findBundledCatalogBookByTitle(title);
  const author = book?.meta.author ?? bundled?.author;
  const width = height * (28 / 41);
  const scale = Math.min(1, width / 180);
  const typographyWidth = width / scale;

  return (
    <View
      style={{ width, height }}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
    >
      <BookSurface
        width={width}
        height={height}
        borderRadius={Math.min(radius.sm, width * 0.04)}
        showShadow={showShadow}
        cover={
          <View
            style={{
              flex: 1,
              isolation: "isolate",
              backgroundColor: loadingCoverColorForTitleAuthor({ title, author }),
            }}
          >
            {artwork ? (
              <Image source={{ uri: artwork }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : null}
            <View
              style={{
                position: "absolute",
                width: typographyWidth,
                height: height / scale,
                transformOrigin: "top left",
                transform: [{ scale }],
              }}
            >
              <BookCoverTypography
                title={title}
                author={author}
                width={typographyWidth}
                coverUri={artwork || undefined}
                showText={shouldRenderCoverTypography(bookId, book?.meta.coverUrl)}
                textTone={bundled?.coverTextTone ?? generatedCoverTextTone({ title, author })}
              />
            </View>
          </View>
        }
      />
    </View>
  );
}

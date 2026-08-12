import { findBundledCatalogBookByTitle } from "@/lib/catalog/bundled-books";
import { useColors } from "@/styles/theme";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Image, View } from "react-native";
import { makeStyles } from "./book-card-styles";
import { BookCoverTypography } from "./book-cover-typography";
import { PerspectiveBook } from "./perspective-book";
import { useResolvedAssetUris } from "./use-resolved-asset-uris";

interface CatalogBookCardProps {
  title: string;
  author: string;
  coverAssetModule: number;
  cardWidth: number;
  isImporting: boolean;
  isInLibrary: boolean;
  onPress: () => void;
}

export function CatalogBookCard({
  title,
  author,
  coverAssetModule,
  cardWidth,
  isImporting,
  isInLibrary,
  onPress,
}: CatalogBookCardProps) {
  const colors = useColors();
  const styles = makeStyles(colors, cardWidth);
  const { t } = useTranslation();
  const coverAssetModules = useMemo(() => [coverAssetModule], [coverAssetModule]);
  const coverUri = useResolvedAssetUris(coverAssetModules).get(coverAssetModule);

  return (
    <PerspectiveBook
      width={cardWidth}
      height={cardWidth * (41 / 28)}
      accessibilityLabel={title}
      accessibilityHint={
        isInLibrary
          ? t("notes.openBook", "Открыть книгу")
          : t("library.catalogAdd", "Добавить в библиотеку")
      }
      disabled={isImporting}
      onPress={onPress}
      cover={
        <View style={styles.coverCanvas}>
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.coverImage} resizeMode="cover" />
          ) : (
            <View style={styles.fallbackCover} />
          )}
          <BookCoverTypography
            title={title}
            author={author}
            width={cardWidth}
            textTone={findBundledCatalogBookByTitle(title)?.coverTextTone ?? "dark"}
          />
        </View>
      }
    />
  );
}

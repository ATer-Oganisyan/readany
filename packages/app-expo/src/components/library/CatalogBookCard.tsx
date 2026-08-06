import { useColors } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import { Image, View } from "react-native";
import { makeStyles } from "./book-card-styles";
import { BookCoverTypography } from "./book-cover-typography";
import { PerspectiveBook } from "./perspective-book";

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
          <Image source={coverAssetModule} style={styles.coverImage} resizeMode="cover" />
          <BookCoverTypography title={title} author={author} width={cardWidth} />
        </View>
      }
    />
  );
}

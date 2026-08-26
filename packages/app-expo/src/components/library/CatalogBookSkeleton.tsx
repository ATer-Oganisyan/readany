import { radius, useColors } from "@/styles/theme";
import { StyleSheet, View } from "react-native";

/**
 * Заглушка книги каталога: занимает место карточки, пока не готова обложка.
 *
 * Статичная: экран каталога остаётся смонтированным под ридером, поэтому
 * бесконечная анимация заглушек зря тратила CPU во время чтения.
 */
export function CatalogBookSkeleton({ cardWidth }: { cardWidth: number }) {
  const colors = useColors();
  const height = cardWidth * (41 / 28);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.base, { width: cardWidth, height, backgroundColor: colors.primary5 }]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: "hidden",
    borderRadius: radius.sm,
    borderCurve: "continuous",
  },
});

import { Text } from "@/components/ui/Typography";
import { interfaceFontFamily } from "@deslop/primitives/native";
import { StyleSheet, View } from "react-native";

interface BookCoverTypographyProps {
  title: string;
  author?: string;
  width: number;
  referenceWidth?: number;
}

function formatBookTitle(title: string) {
  return title.replace(/(^|\s)([вксуо]) +(?=\S)/giu, "$1$2\u00A0");
}

export function BookCoverTypography({
  title,
  author,
  width,
  referenceWidth = width,
}: BookCoverTypographyProps) {
  const scale = Math.min(1, width / referenceWidth);
  const titleSize = Math.max(12, Math.min(18, referenceWidth * 0.12)) * scale;
  const authorSize = 13 * scale;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.overlay,
        {
          padding: 20 * scale,
          paddingTop: 16 * scale,
          gap: 4 * scale,
        },
      ]}
    >
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        numberOfLines={3}
        style={[
          styles.title,
          {
            fontFamily: interfaceFontFamily.bold,
            fontSize: titleSize,
            lineHeight: titleSize * 1.05,
          },
        ]}
      >
        {formatBookTitle(title)}
      </Text>
      {author ? (
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.74}
          numberOfLines={2}
          style={[
            styles.author,
            {
              fontFamily: interfaceFontFamily.bold,
              fontSize: authorSize,
              lineHeight: authorSize * (14 / 13),
            },
          ]}
        >
          {author}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 12,
  },
  title: {
    flexShrink: 1,
    color: "#151515",
    letterSpacing: -0.2,
    mixBlendMode: "overlay",
  },
  author: {
    flexShrink: 1,
    color: "rgba(21,21,21,0.72)",
    letterSpacing: -0.1,
    mixBlendMode: "overlay",
  },
});

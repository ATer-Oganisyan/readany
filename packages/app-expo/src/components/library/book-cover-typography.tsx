import { Text } from "@/components/ui/Typography";
import { formatBookCoverTitle } from "@/lib/book/format-book-cover-title";
import { interfaceFontFamily } from "@deslop/primitives/native";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  type NativeSyntheticEvent,
  StyleSheet,
  type TextLayoutEventData,
  View,
} from "react-native";

interface BookCoverTypographyProps {
  title: string;
  author?: string;
  width: number;
  referenceWidth?: number;
  titleFontSize?: number;
  authorFontSize?: number;
  bottomAccessory?: ReactNode;
}

function hasBrokenWord(title: string, renderedLines: readonly string[]) {
  const plainTitle = title.replaceAll("\u2060", "");
  let searchOffset = 0;

  for (const renderedLine of renderedLines.slice(0, -1)) {
    const line = renderedLine.replaceAll("\u2060", "").trim();
    if (!line) continue;

    const lineStart = plainTitle.indexOf(line, searchOffset);
    if (lineStart < 0) continue;

    const lineEnd = lineStart + line.length;
    if (lineEnd < plainTitle.length && !/\s/u.test(plainTitle[lineEnd])) return true;

    searchOffset = lineEnd;
    while (searchOffset < plainTitle.length && /\s/u.test(plainTitle[searchOffset])) {
      searchOffset += 1;
    }
  }

  return false;
}

export function BookCoverTypography({
  title,
  author,
  width,
  referenceWidth = width,
  titleFontSize,
  authorFontSize,
  bottomAccessory,
}: BookCoverTypographyProps) {
  const scale = Math.min(1, width / referenceWidth);
  const titleSize = titleFontSize ?? Math.max(12, Math.min(18, referenceWidth * 0.12)) * scale;
  const authorSize = authorFontSize ?? 13 * scale;
  const [fittedTitleSize, setFittedTitleSize] = useState(titleSize);
  const formattedTitle = formatBookCoverTitle(title);

  useEffect(() => setFittedTitleSize(titleSize), [title, titleSize, width]);

  const handleTitleLayout = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<TextLayoutEventData>) => {
      if (
        fittedTitleSize > 6 &&
        hasBrokenWord(
          formattedTitle,
          nativeEvent.lines.map((line) => line.text),
        )
      ) {
        setFittedTitleSize((currentSize) => Math.max(6, currentSize - 0.5));
      }
    },
    [fittedTitleSize, formattedTitle],
  );

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
        onTextLayout={handleTitleLayout}
        style={[
          styles.title,
          {
            fontFamily: interfaceFontFamily.bold,
            fontSize: fittedTitleSize,
            lineHeight: fittedTitleSize * 1.05,
          },
        ]}
      >
        {formattedTitle}
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
      {bottomAccessory ? <View style={styles.bottomAccessory}>{bottomAccessory}</View> : null}
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
  bottomAccessory: {
    alignItems: "flex-start",
    marginTop: "auto",
  },
});

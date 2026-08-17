import { Text } from "@/components/ui/Typography";
import type { CoverTextTone } from "@/lib/book/cover-text-contrast";
import { formatBookCoverTitle } from "@/lib/book/format-book-cover-title";
import { interfaceFontFamily, serifTextFontFamily } from "@deslop/primitives/native";
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
  leftInsetAdjustment?: number;
  showText?: boolean;
  bottomAccessory?: ReactNode;
  textTone?: CoverTextTone;
}

function normalizeLayoutText(value: string) {
  return value.replaceAll("\u00A0", " ").replaceAll("\u2060", "");
}

function hasBrokenWord(title: string, renderedLines: readonly string[]) {
  const plainTitle = normalizeLayoutText(title);
  let searchOffset = 0;

  for (const renderedLine of renderedLines.slice(0, -1)) {
    const line = normalizeLayoutText(renderedLine).trim();
    if (!line) continue;

    const lineStart = plainTitle.indexOf(line, searchOffset);
    if (lineStart < 0) continue;

    const lineEnd = lineStart + line.length;
    const previousCharacter = plainTitle[lineEnd - 1];
    const endsAtAllowedWordBreak = /[-‐‒–—]/u.test(previousCharacter);
    if (
      lineEnd < plainTitle.length &&
      !/\s/u.test(plainTitle[lineEnd]) &&
      !endsAtAllowedWordBreak
    ) {
      return true;
    }

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
  leftInsetAdjustment = 4,
  showText = true,
  bottomAccessory,
  textTone = "dark",
}: BookCoverTypographyProps) {
  const scale = Math.min(1, width / referenceWidth);
  const titleSize = titleFontSize ?? Math.max(12, Math.min(18, referenceWidth * 0.12)) * scale;
  const minimumTitleSize = Math.min(titleSize, 12);
  const authorSize = authorFontSize ?? 13 * scale;
  const formattedTitle = formatBookCoverTitle(title);
  const [fittedTitleSize, setFittedTitleSize] = useState(titleSize);
  const textColor = textTone === "light" ? "#FFFFFF" : "#000000";

  useEffect(() => setFittedTitleSize(titleSize), [titleSize]);

  const handleTitleLayout = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<TextLayoutEventData>) => {
      if (
        fittedTitleSize > minimumTitleSize &&
        hasBrokenWord(
          formattedTitle,
          nativeEvent.lines.map((line) => line.text),
        )
      ) {
        setFittedTitleSize((currentSize) =>
          currentSize === fittedTitleSize
            ? Math.max(minimumTitleSize, currentSize - 0.5)
            : currentSize,
        );
      }
    },
    [fittedTitleSize, formattedTitle, minimumTitleSize],
  );

  // Keep two overlay passes: the full-strength pass and the softer reinforcement pass.
  const renderTextContent = (withLayoutHandler: boolean) => (
    <>
      <Text
        numberOfLines={6}
        onTextLayout={withLayoutHandler ? handleTitleLayout : undefined}
        style={[
          styles.title,
          {
            fontFamily: interfaceFontFamily.semibold,
            fontWeight: "600",
            fontSize: fittedTitleSize,
            lineHeight: fittedTitleSize * 1.05,
            color: textColor,
            opacity: 1,
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
              fontFamily: serifTextFontFamily.regular,
              fontSize: authorSize,
              lineHeight: authorSize * (14 / 13),
              color: textColor,
              opacity: 1,
            },
          ]}
        >
          {author}
        </Text>
      ) : null}
    </>
  );

  return (
    <>
      {showText ? (
        <>
          <View
            pointerEvents="none"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.typographySoftLayer,
              {
                padding: 20 * scale,
                paddingLeft: 20 * scale + leftInsetAdjustment,
                paddingTop: 16 * scale,
                gap: 4 * scale,
                mixBlendMode: "overlay",
              },
            ]}
          >
            {renderTextContent(false)}
          </View>
          <View
            pointerEvents="none"
            style={[
              styles.typographyLayer,
              {
                padding: 20 * scale,
                paddingLeft: 20 * scale + leftInsetAdjustment,
                paddingTop: 16 * scale,
                gap: 4 * scale,
                mixBlendMode: "overlay",
              },
            ]}
          >
            {renderTextContent(true)}
          </View>
        </>
      ) : null}
      {bottomAccessory ? (
        <View
          pointerEvents="none"
          style={[
            styles.accessoryLayer,
            {
              padding: 20 * scale,
              paddingLeft: 20 * scale + leftInsetAdjustment,
              paddingTop: 16 * scale,
            },
          ]}
        >
          <View style={styles.bottomAccessory}>{bottomAccessory}</View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  typographySoftLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 11,
    opacity: 0.3,
  },
  typographyLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 12,
    opacity: 1,
  },
  accessoryLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 13,
  },
  title: {
    flexShrink: 1,
    letterSpacing: -0.2,
  },
  author: {
    flexShrink: 1,
    letterSpacing: -0.1,
  },
  bottomAccessory: {
    alignItems: "flex-start",
    marginTop: "auto",
  },
});

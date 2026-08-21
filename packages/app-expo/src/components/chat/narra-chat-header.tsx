import { ChevronLeftIcon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Typography";
import {
  bodyTypography,
  captionTypography,
  fontWeight,
  titleFontFamily,
  useTheme,
} from "@/styles/theme";
import { radiusPixels, spacingPixels } from "@deslop/primitives";
import { Host, Image } from "@expo/ui/swift-ui";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

/** Высота общей шапки чата без системной safe area. */
export const NARRA_CHAT_HEADER_HEIGHT = spacingPixels[44] + spacingPixels[12];
/** Дополнительный отступ от drag indicator внутри книжной form-sheet. */
export const NARRA_CHAT_EMBEDDED_TOP_INSET = spacingPixels[8];

interface NarraChatHeaderProps {
  backLabel: string;
  onBack: () => void;
  title: string;
  subtitle?: string;
  onTitlePress?: () => void;
  trailing?: ReactNode;
  trailingLabel?: string;
  onTrailingPress?: () => void;
  safeAreaTop?: number;
  transparent?: boolean;
}

/**
 * Общая шапка всех чатов Narra.
 *
 * Экран из таба и тот же чат внутри книжной шторки используют один компонент;
 * отличается только верхняя safe area, которой у form-sheet уже нет.
 */
export function NarraChatHeader({
  backLabel,
  onBack,
  title,
  subtitle,
  onTitlePress,
  trailing,
  trailingLabel,
  onTrailingPress,
  safeAreaTop = 0,
  transparent = true,
}: NarraChatHeaderProps) {
  const { colors, isDark } = useTheme();
  const glassAvailable = Platform.OS === "ios" && isLiquidGlassAvailable();
  const titleContent = (
    <View style={styles.titleContent}>
      <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text
          numberOfLines={1}
          style={[
            styles.subtitle,
            {
              color: colors.mutedForeground,
              mixBlendMode: isDark ? "screen" : "multiply",
            },
          ]}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );

  const titleControl = subtitle ? (
    glassAvailable ? (
      <GlassView
        colorScheme={isDark ? "dark" : "light"}
        glassEffectStyle="regular"
        isInteractive={Boolean(onTitlePress)}
        style={styles.titleGlass}
      >
        <Pressable
          accessibilityLabel={`${title}, ${subtitle}`}
          accessibilityRole={onTitlePress ? "button" : undefined}
          disabled={!onTitlePress}
          onPress={onTitlePress}
          style={styles.titlePressable}
        >
          {titleContent}
        </Pressable>
      </GlassView>
    ) : (
      <Pressable
        accessibilityLabel={`${title}, ${subtitle}`}
        accessibilityRole={onTitlePress ? "button" : undefined}
        disabled={!onTitlePress}
        onPress={onTitlePress}
        style={[
          styles.titleGlass,
          styles.fallbackSurface,
          { backgroundColor: colors.elevation1, borderColor: colors.border },
        ]}
      >
        {titleContent}
      </Pressable>
    )
  ) : (
    titleContent
  );

  const backControl = (
    <Pressable
      accessibilityLabel={backLabel}
      accessibilityRole="button"
      hitSlop={spacingPixels[8]}
      onPress={onBack}
      style={({ pressed }) => [styles.controlPressable, pressed && styles.pressed]}
    >
      {Platform.OS === "ios" ? (
        <Host matchContents pointerEvents="none" style={styles.backSymbolHost}>
          <Image systemName="chevron.backward" size={20} color={colors.foreground} />
        </Host>
      ) : (
        <ChevronLeftIcon size={24} color={colors.foreground} />
      )}
    </Pressable>
  );

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: transparent ? "transparent" : colors.background,
          borderBottomColor: colors.border,
          borderBottomWidth: transparent ? 0 : StyleSheet.hairlineWidth,
          height: safeAreaTop + NARRA_CHAT_HEADER_HEIGHT,
          paddingTop: safeAreaTop,
        },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.side}>
          {glassAvailable ? (
            <GlassView
              colorScheme={isDark ? "dark" : "light"}
              glassEffectStyle="regular"
              isInteractive
              style={styles.controlGlass}
            >
              {backControl}
            </GlassView>
          ) : (
            <View
              style={[
                styles.controlGlass,
                styles.fallbackSurface,
                { backgroundColor: colors.elevation1, borderColor: colors.border },
              ]}
            >
              {backControl}
            </View>
          )}
        </View>

        <View style={styles.center}>{titleControl}</View>

        <View style={styles.side}>
          {trailing ? (
            glassAvailable ? (
              <GlassView
                colorScheme={isDark ? "dark" : "light"}
                glassEffectStyle="regular"
                isInteractive={Boolean(onTrailingPress)}
                style={styles.controlGlass}
              >
                <Pressable
                  accessibilityLabel={trailingLabel}
                  accessibilityRole={onTrailingPress ? "button" : undefined}
                  disabled={!onTrailingPress}
                  hitSlop={spacingPixels[8]}
                  onPress={onTrailingPress}
                  style={({ pressed }) => [styles.controlPressable, pressed && styles.pressed]}
                >
                  {trailing}
                </Pressable>
              </GlassView>
            ) : (
              <Pressable
                accessibilityLabel={trailingLabel}
                accessibilityRole={onTrailingPress ? "button" : undefined}
                disabled={!onTrailingPress}
                hitSlop={spacingPixels[8]}
                onPress={onTrailingPress}
                style={({ pressed }) => [
                  styles.controlGlass,
                  styles.fallbackSurface,
                  { backgroundColor: colors.elevation1, borderColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                {trailing}
              </Pressable>
            )
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 10,
  },
  row: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    paddingHorizontal: spacingPixels[12],
  },
  side: {
    alignItems: "center",
    height: spacingPixels[44],
    justifyContent: "center",
    width: spacingPixels[44],
  },
  center: {
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacingPixels[8],
  },
  controlGlass: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radiusPixels.full,
    height: spacingPixels[44],
    justifyContent: "center",
    width: spacingPixels[44],
  },
  controlPressable: {
    alignItems: "center",
    height: "100%",
    justifyContent: "center",
    width: "100%",
  },
  backSymbolHost: {
    alignItems: "center",
    justifyContent: "center",
  },
  titleGlass: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radiusPixels.full,
    height: spacingPixels[44],
    justifyContent: "center",
    maxWidth: 220,
    minWidth: 104,
    paddingHorizontal: spacingPixels[12],
  },
  titlePressable: {
    alignItems: "center",
    alignSelf: "stretch",
    flex: 1,
    justifyContent: "center",
  },
  titleContent: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
  },
  title: {
    ...bodyTypography,
    fontFamily: titleFontFamily,
    fontWeight: fontWeight.semibold,
    maxWidth: 190,
  },
  subtitle: {
    ...captionTypography,
    fontFamily: bodyTypography.fontFamily,
    textTransform: "none",
  },
  fallbackSurface: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.62 },
});

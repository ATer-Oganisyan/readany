import { NativeSymbol } from "@/components/ui/NativeSymbol";
import { fontFamily, useTheme } from "@/styles/theme";
import { radiusPixels, spacingPixels } from "@deslop/primitives";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useCallback, useEffect, useState } from "react";
import type { ComponentPropsWithRef } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputContentSizeChangeEvent,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { IMessage, InputToolbarProps } from "../../../vendor/react-native-chat/src";

type RuntimeToolbarProps<TMessage extends IMessage> = InputToolbarProps<TMessage> & {
  allowSendWithoutText?: boolean;
  isStreaming?: boolean;
  onSend?: (
    message: Partial<TMessage> | Partial<TMessage>[],
    shouldResetInputToolbar: boolean,
  ) => void;
  onStop?: () => void;
  textInputProps?: ComponentPropsWithRef<typeof TextInput>;
};

const controlSize = 36;
const maxInputHeight = 120;
const hitSlop = Object.freeze({ bottom: 6, left: 6, right: 6, top: 6 });

export function NarraChatComposer<TMessage extends IMessage>({
  allowSendWithoutText = false,
  isStreaming = false,
  onStop,
  ...props
}: RuntimeToolbarProps<TMessage>) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [inputHeight, setInputHeight] = useState(controlSize);
  const text = props.text ?? "";
  const inputProps = props.textInputProps;
  const onSend = props.onSend;
  const canSend = (text.trim().length > 0 || allowSendWithoutText) && !isStreaming;

  useEffect(() => {
    if (!text) setInputHeight(controlSize);
  }, [text]);

  const handleContentSizeChange = useCallback(
    (event: TextInputContentSizeChangeEvent) => {
      inputProps?.onContentSizeChange?.(event);
      const nextHeight = Math.max(
        controlSize,
        Math.min(maxInputHeight, event.nativeEvent.contentSize.height),
      );
      setInputHeight(nextHeight);
    },
    [inputProps],
  );

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend?.({ text: text.trim() } as Partial<TMessage>, true);
  }, [canSend, onSend, text]);

  const accessory = props.renderAccessory?.(props);
  const surface = (
    <View style={styles.row}>
      <TextInput
        {...inputProps}
        accessibilityLabel={inputProps?.placeholder}
        enablesReturnKeyAutomatically
        keyboardAppearance={isDark ? "dark" : "light"}
        maxFontSizeMultiplier={2}
        multiline
        onContentSizeChange={handleContentSizeChange}
        placeholder={inputProps?.placeholder}
        placeholderTextColor={inputProps?.placeholderTextColor ?? colors.mutedForeground}
        scrollEnabled={inputHeight >= maxInputHeight}
        style={[styles.input, { color: colors.foreground, height: inputHeight }, inputProps?.style]}
        textAlignVertical="top"
        value={text}
      />

      <Pressable
        accessibilityLabel={isStreaming ? "Остановить ответ" : "Отправить"}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSend && !(isStreaming && onStop) }}
        disabled={!canSend && !(isStreaming && onStop)}
        hitSlop={hitSlop}
        onPress={isStreaming ? onStop : handleSend}
        style={({ pressed }) => [
          styles.send,
          { backgroundColor: colors.primary },
          !canSend && !isStreaming && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        {isStreaming && !onStop ? (
          <ActivityIndicator color={colors.primaryForeground} size="small" />
        ) : isStreaming ? (
          <View style={[styles.stopGlyph, { backgroundColor: colors.primaryForeground }]} />
        ) : (
          <NativeSymbol
            color={colors.primaryForeground}
            fallback="arrow_upward"
            name="arrow.up"
            size={19}
          />
        )}
      </Pressable>
    </View>
  );

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.backgroundSecondary,
          paddingBottom: insets.bottom + spacingPixels[8],
        },
      ]}
    >
      {accessory}
      {Platform.OS === "ios" && isLiquidGlassAvailable() ? (
        <GlassView
          colorScheme={isDark ? "dark" : "light"}
          glassEffectStyle="regular"
          isInteractive
          style={styles.surface}
        >
          {surface}
        </GlassView>
      ) : (
        <View
          style={[
            styles.surface,
            styles.surfaceFallback,
            { backgroundColor: colors.elevation1, borderColor: colors.border },
          ]}
        >
          {surface}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacingPixels[6],
    paddingHorizontal: spacingPixels[8],
    paddingTop: spacingPixels[6],
  },
  surface: {
    borderCurve: "continuous",
    borderRadius: radiusPixels[22],
    overflow: "hidden",
    padding: spacingPixels[6],
  },
  surfaceFallback: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacingPixels[4],
  },
  input: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: 16,
    lineHeight: 20,
    maxHeight: maxInputHeight,
    minHeight: controlSize,
    minWidth: 0,
    paddingBottom: spacingPixels[8],
    paddingHorizontal: spacingPixels[10],
    paddingTop: spacingPixels[4],
  },
  send: {
    alignItems: "center",
    borderRadius: radiusPixels.full,
    height: controlSize,
    justifyContent: "center",
    width: controlSize,
  },
  disabled: {
    opacity: 0.32,
  },
  pressed: {
    opacity: 0.65,
  },
  stopGlyph: {
    borderRadius: radiusPixels[4],
    height: 10,
    width: 10,
  },
});

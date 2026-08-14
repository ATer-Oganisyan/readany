import { NativeSymbol } from "@/components/ui/NativeSymbol";
import { useKeyboardInsets } from "@/hooks/use-keyboard-insets";
import { fontFamily, useTheme } from "@/styles/theme";
import { radiusPixels, spacingPixels } from "@deslop/primitives";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useCallback, useEffect, useState } from "react";
import type { ComponentPropsWithRef } from "react";
import { useTranslation } from "react-i18next";
import {
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputContentSizeChangeEvent,
  View,
} from "react-native";
import type { IMessage, InputToolbarProps } from "../../../vendor/react-native-chat/src";

type RuntimeToolbarProps<TMessage extends IMessage> = InputToolbarProps<TMessage> & {
  allowSendWithoutText?: boolean;
  isStreaming?: boolean;
  onSend?: (
    message: Partial<TMessage> | Partial<TMessage>[],
    shouldResetInputToolbar: boolean,
  ) => void;
  floating?: boolean;
  onHeightChange?: (height: number) => void;
  onStop?: () => void;
  textInputProps?: ComponentPropsWithRef<typeof TextInput>;
};

const controlSize = 36;
const maxInputHeight = 120;
const hitSlop = Object.freeze({ bottom: 6, left: 6, right: 6, top: 6 });

export function NarraChatComposer<TMessage extends IMessage>({
  allowSendWithoutText = false,
  floating = false,
  isStreaming = false,
  onHeightChange,
  onStop,
  ...props
}: RuntimeToolbarProps<TMessage>) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const keyboardInsets = useKeyboardInsets();
  const [inputHeight, setInputHeight] = useState(controlSize);
  const text = props.text ?? "";
  const inputProps = props.textInputProps;
  const placeholder = inputProps?.placeholder ?? "";
  const placeholderColor = inputProps?.placeholderTextColor ?? colors.mutedForeground;
  const onSend = props.onSend;
  const canSend = (text.trim().length > 0 || allowSendWithoutText) && !isStreaming;
  const canStop = isStreaming && Boolean(onStop);

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

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onHeightChange?.(Math.ceil(event.nativeEvent.layout.height)),
    [onHeightChange],
  );

  const accessory = props.renderAccessory?.(props);
  const surface = (
    <View style={styles.row}>
      <View style={[styles.inputFrame, { height: inputHeight }]}>
        {!text && placeholder ? (
          <Text
            numberOfLines={1}
            pointerEvents="none"
            style={[styles.placeholder, { color: placeholderColor }]}
          >
            {placeholder}
          </Text>
        ) : null}
        <TextInput
          {...inputProps}
          accessibilityLabel={placeholder}
          caretHidden={false}
          enablesReturnKeyAutomatically
          keyboardAppearance={isDark ? "dark" : "light"}
          maxFontSizeMultiplier={2}
          multiline
          onContentSizeChange={handleContentSizeChange}
          placeholder={undefined}
          scrollEnabled={inputHeight >= maxInputHeight}
          style={[styles.input, { color: colors.foreground }, inputProps?.style]}
          textAlignVertical={inputHeight > controlSize ? "top" : "center"}
          value={text}
        />
      </View>

      <Pressable
        accessibilityLabel={
          canStop ? t("chat.stopResponse", "Остановить ответ") : t("narra.send", "Отправить")
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSend && !canStop }}
        disabled={!canSend && !canStop}
        hitSlop={hitSlop}
        onPress={canStop ? onStop : handleSend}
        style={({ pressed }) => [
          styles.send,
          { backgroundColor: colors.primary },
          !canSend && !isStreaming && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        {canStop ? (
          <View style={[styles.stopGlyph, { backgroundColor: colors.primaryForeground }]} />
        ) : (
          <View pointerEvents="none" style={styles.sendIconFrame}>
            <NativeSymbol
              color={colors.primaryForeground}
              fallback="arrow_upward"
              name="arrow.up"
              size={20}
            />
          </View>
        )}
      </Pressable>
    </View>
  );

  return (
    <View
      onLayout={handleLayout}
      style={[
        styles.container,
        floating && styles.floatingContainer,
        {
          backgroundColor: "transparent",
          paddingBottom:
            spacingPixels[8] + (keyboardInsets.isVisible ? 0 : keyboardInsets.safeAreaBottom),
        },
      ]}
    >
      {accessory}
      {Platform.OS === "ios" && isLiquidGlassAvailable() ? (
        <GlassView
          colorScheme={isDark ? "dark" : "light"}
          glassEffectStyle="clear"
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
  floatingContainer: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 1,
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
    alignItems: "center",
    flexDirection: "row",
    gap: spacingPixels[4],
  },
  inputFrame: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
    position: "relative",
  },
  input: {
    fontFamily: fontFamily.regular,
    fontSize: 16,
    height: "100%",
    lineHeight: 20,
    maxHeight: maxInputHeight,
    minHeight: controlSize,
    minWidth: 0,
    paddingHorizontal: spacingPixels[10],
    paddingVertical: spacingPixels[8],
    width: "100%",
  },
  placeholder: {
    fontFamily: fontFamily.regular,
    fontSize: 16,
    left: spacingPixels[10],
    lineHeight: 20,
    position: "absolute",
    right: spacingPixels[10],
  },
  send: {
    alignItems: "center",
    borderRadius: radiusPixels.full,
    flexShrink: 0,
    height: controlSize,
    justifyContent: "center",
    width: controlSize,
  },
  sendIconFrame: {
    alignItems: "center",
    height: spacingPixels[20],
    justifyContent: "center",
    width: spacingPixels[20],
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

import { TextInput } from "@/components/ui/Typography";
import { useTheme } from "@/styles/theme";
import { interfaceFontFamily } from "@deslop/primitives/native";
import { Host, TextField, useNativeState } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  lineHeight,
  padding,
  textFieldStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import type { NativeNoteEditorProps } from "./NativeNoteEditor";

/** Full-screen SwiftUI multiline editor matching the system Notes composition surface. */
export function NativeNoteEditor({
  onChange,
  autoFocus = false,
  initialValue = "",
}: NativeNoteEditorProps) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const text = useNativeState(initialValue);
  const [legacyText, setLegacyText] = useState(initialValue);
  const handleChange = useCallback((value: string) => onChange(value), [onChange]);

  // SwiftUI's exact line height is available from iOS 26.
  if (Number.parseInt(String(Platform.Version), 10) < 26) {
    return (
      <TextInput
        value={legacyText}
        onChangeText={(value) => {
          setLegacyText(value);
          onChange(value);
        }}
        placeholder={t("notes.startWriting", "Начните писать…")}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        autoFocus={autoFocus}
        multiline
        textAlignVertical="top"
        style={{
          flex: 1,
          paddingHorizontal: 20,
          paddingVertical: 16,
          backgroundColor: colors.background,
          color: colors.foreground,
          fontSize: 18,
          lineHeight: 18 * 1.4,
        }}
      />
    );
  }

  return (
    <Host
      colorScheme={isDark ? "dark" : "light"}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <TextField
        axis="vertical"
        placeholder={t("notes.startWriting", "Начните писать…")}
        text={text}
        autoFocus={autoFocus}
        onTextChange={handleChange}
        modifiers={[
          frame({
            minWidth: 0,
            maxWidth: 10_000,
            minHeight: 0,
            maxHeight: 10_000,
            alignment: "topLeading",
          }),
          padding({ horizontal: 20, vertical: 16 }),
          textFieldStyle("plain"),
          font({ family: interfaceFontFamily.regular, size: 18 }),
          lineHeight(18 * 1.4),
          foregroundStyle(colors.foreground),
          tint(colors.primary),
        ]}
      />
    </Host>
  );
}

export type { NativeNoteEditorProps } from "./NativeNoteEditor";

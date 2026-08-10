import { radius, useTheme } from "@/styles/theme";
import { interfaceFontFamily } from "@deslop/primitives/native";
import { Host, TextField, useNativeState } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  padding,
  textFieldStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { RichTextEditorProps } from "./RichTextEditor";

/** Native multiline SwiftUI editor. */
export function RichTextEditor({
  initialContent = "",
  onChange,
  placeholder,
  autoFocus = false,
}: RichTextEditorProps) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const text = useNativeState(initialContent);
  const resolvedPlaceholder = placeholder ?? t("common.writeYourThoughts", "Запишите мысль");
  const handleChange = useCallback((value: string) => onChange?.(value), [onChange]);

  return (
    <Host
      colorScheme={isDark ? "dark" : "light"}
      style={{
        flex: 1,
        backgroundColor: colors.elevation1,
        borderRadius: radius.lg,
        overflow: "hidden",
      }}
    >
      <TextField
        axis="vertical"
        text={text}
        placeholder={resolvedPlaceholder}
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
          padding({ all: 12 }),
          textFieldStyle("plain"),
          font({ family: interfaceFontFamily.regular, size: 16 }),
          foregroundStyle(colors.foreground),
          tint(colors.primary),
        ]}
      />
    </Host>
  );
}

export type { RichTextEditorProps } from "./RichTextEditor";

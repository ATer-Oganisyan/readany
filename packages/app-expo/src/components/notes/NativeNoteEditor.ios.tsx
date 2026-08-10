import { useTheme } from "@/styles/theme";
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
import type { NativeNoteEditorProps } from "./NativeNoteEditor";

/** Full-screen SwiftUI multiline editor matching the system Notes composition surface. */
export function NativeNoteEditor({
  onChange,
  autoFocus = false,
  initialValue = "",
}: NativeNoteEditorProps) {
  const { colors, isDark } = useTheme();
  const text = useNativeState(initialValue);
  const handleChange = useCallback((value: string) => onChange(value), [onChange]);

  return (
    <Host
      colorScheme={isDark ? "dark" : "light"}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <TextField
        axis="vertical"
        placeholder="Начните писать…"
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
          foregroundStyle(colors.foreground),
          tint(colors.primary),
        ]}
      />
    </Host>
  );
}

export type { NativeNoteEditorProps } from "./NativeNoteEditor";

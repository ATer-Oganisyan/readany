import { useTheme } from "@/styles/theme";
import { Text as ComposeText, Host, TextField, useNativeState } from "@expo/ui/jetpack-compose";
import { fillMaxSize } from "@expo/ui/jetpack-compose/modifiers";
import { useCallback } from "react";
import type { NativeNoteEditorProps } from "./NativeNoteEditor";

/** Full-screen native Jetpack Compose note editor. */
export function NativeNoteEditor({
  onChange,
  autoFocus = false,
  initialValue = "",
}: NativeNoteEditorProps) {
  const { colors } = useTheme();
  const text = useNativeState(initialValue);
  const handleChange = useCallback((value: string) => onChange(value), [onChange]);

  return (
    <Host style={{ flex: 1, backgroundColor: colors.background }}>
      <TextField
        value={text}
        autoFocus={autoFocus}
        singleLine={false}
        minLines={12}
        maxLines={1_000}
        onValueChange={handleChange}
        modifiers={[fillMaxSize()]}
        colors={{
          focusedTextColor: colors.foreground,
          unfocusedTextColor: colors.foreground,
          focusedContainerColor: colors.background,
          unfocusedContainerColor: colors.background,
          cursorColor: colors.primary,
          focusedIndicatorColor: "transparent",
          unfocusedIndicatorColor: "transparent",
          focusedPlaceholderColor: colors.mutedForeground,
          unfocusedPlaceholderColor: colors.mutedForeground,
        }}
      >
        <TextField.Placeholder>
          <ComposeText color={colors.mutedForeground}>Начните писать…</ComposeText>
        </TextField.Placeholder>
      </TextField>
    </Host>
  );
}

export type { NativeNoteEditorProps } from "./NativeNoteEditor";

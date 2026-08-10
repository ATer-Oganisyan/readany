import { useTheme } from "@/styles/theme";
import { Text as ComposeText, Host, TextField, useNativeState } from "@expo/ui/jetpack-compose";
import { fillMaxSize } from "@expo/ui/jetpack-compose/modifiers";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { RichTextEditorProps } from "./RichTextEditor";

/** Native multiline Jetpack Compose editor. */
export function RichTextEditor({
  initialContent = "",
  onChange,
  placeholder,
  autoFocus = false,
}: RichTextEditorProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const text = useNativeState(initialContent);
  const resolvedPlaceholder = placeholder ?? t("common.writeYourThoughts", "Запишите мысль");
  const handleChange = useCallback((value: string) => onChange?.(value), [onChange]);

  return (
    <Host style={{ flex: 1 }}>
      <TextField
        value={text}
        autoFocus={autoFocus}
        singleLine={false}
        minLines={6}
        maxLines={1_000}
        onValueChange={handleChange}
        modifiers={[fillMaxSize()]}
        colors={{
          focusedTextColor: colors.foreground,
          unfocusedTextColor: colors.foreground,
          focusedContainerColor: colors.elevation1,
          unfocusedContainerColor: colors.elevation1,
          cursorColor: colors.primary,
          focusedIndicatorColor: colors.primary,
          unfocusedIndicatorColor: colors.border,
          focusedPlaceholderColor: colors.mutedForeground,
          unfocusedPlaceholderColor: colors.mutedForeground,
        }}
      >
        <TextField.Placeholder>
          <ComposeText color={colors.mutedForeground}>{resolvedPlaceholder}</ComposeText>
        </TextField.Placeholder>
      </TextField>
    </Host>
  );
}

export type { RichTextEditorProps } from "./RichTextEditor";

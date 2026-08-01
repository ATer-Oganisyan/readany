import { TextInput } from "@/components/ui/Typography";
import { radius, useColors } from "@/styles/theme";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

export interface RichTextEditorProps {
  initialContent?: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/** Web fallback. iOS and Android resolve their platform-native editors. */
export function RichTextEditor({
  initialContent = "",
  onChange,
  placeholder,
  autoFocus = false,
}: RichTextEditorProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const [value, setValue] = useState(initialContent);
  const resolvedPlaceholder = placeholder ?? t("common.writeYourThoughts", "Запишите мысль");

  const handleChange = useCallback(
    (text: string) => {
      setValue(text);
      onChange?.(text);
    },
    [onChange],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.elevation1 }]}>
      <TextInput
        value={value}
        onChangeText={handleChange}
        placeholder={resolvedPlaceholder}
        placeholderTextColor={colors.mutedForeground}
        autoFocus={autoFocus}
        multiline
        textAlignVertical="top"
        style={[styles.editor, { color: colors.foreground }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  editor: {
    flex: 1,
    padding: 12,
    fontSize: 16,
    lineHeight: 24,
  },
});

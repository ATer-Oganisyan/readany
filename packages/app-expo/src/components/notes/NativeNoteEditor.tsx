import { TextInput } from "@/components/ui/Typography";
import { useColors } from "@/styles/theme";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

export interface NativeNoteEditorProps {
  onChange: (value: string) => void;
  autoFocus?: boolean;
  initialValue?: string;
}

/** Web fallback. Native platforms resolve their system editor implementations. */
export function NativeNoteEditor({
  onChange,
  autoFocus = false,
  initialValue = "",
}: NativeNoteEditorProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const handleChange = useCallback(
    (nextValue: string) => {
      setValue(nextValue);
      onChange(nextValue);
    },
    [onChange],
  );

  return (
    <TextInput
      value={value}
      onChangeText={handleChange}
      placeholder={t("notes.startWriting", "Начните писать…")}
      placeholderTextColor={colors.mutedForeground}
      autoFocus={autoFocus}
      multiline
      textAlignVertical="top"
      style={{
        flex: 1,
        paddingHorizontal: 20,
        paddingVertical: 16,
        color: colors.foreground,
        backgroundColor: colors.background,
        fontSize: 18,
        lineHeight: 26,
      }}
    />
  );
}

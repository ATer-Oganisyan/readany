import { TextInput } from "@/components/ui/Typography";
import { useColors } from "@/styles/theme";
import { useCallback, useState } from "react";

export interface NativeNoteEditorProps {
  onChange: (value: string) => void;
  autoFocus?: boolean;
}

/** Web fallback. Native platforms resolve their system editor implementations. */
export function NativeNoteEditor({ onChange, autoFocus = false }: NativeNoteEditorProps) {
  const colors = useColors();
  const [value, setValue] = useState("");
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
      placeholder="Начните писать…"
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

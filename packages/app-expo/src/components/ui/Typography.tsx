import { interfaceFontFamily } from "@deslop/primitives/native";
import { forwardRef } from "react";
import {
  Text as NativeText,
  TextInput as NativeTextInput,
  StyleSheet,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "react-native";

export type TextInputHandle = NativeTextInput;

function resolveInterfaceFont(style: TextProps["style"] | TextInputProps["style"]): string {
  const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
  if (flattened?.fontFamily) return flattened.fontFamily;

  const numericWeight = Number(flattened?.fontWeight ?? 400);
  if (numericWeight >= 700) return interfaceFontFamily.bold;
  if (numericWeight >= 500) return interfaceFontFamily.semibold;
  if (numericWeight <= 300) return interfaceFontFamily.light;
  return interfaceFontFamily.regular;
}

/** Text with the Interface family selected from the effective font weight. */
export const Text = forwardRef<NativeText, TextProps>(function InterfaceText(
  { style, ...props },
  ref,
) {
  return (
    <NativeText ref={ref} {...props} style={[{ fontFamily: resolveInterfaceFont(style) }, style]} />
  );
});

/** Text input using the same Interface typography rules as labels and body text. */
export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function InterfaceTextInput(
  { style, ...props },
  ref,
) {
  return (
    <NativeTextInput
      ref={ref}
      {...props}
      style={[{ fontFamily: resolveInterfaceFont(style) }, style]}
    />
  );
});

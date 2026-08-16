export function getAndroidChatKeyboardAvoidingViewProps(keyboardVerticalOffset: number) {
  return {
    behavior: "padding" as const,
    keyboardVerticalOffset,
  };
}

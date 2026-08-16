import { describe, expect, it } from "vitest";
import { getAndroidChatKeyboardAvoidingViewProps } from "./keyboard-avoiding-view";

describe("Android chat keyboard avoidance", () => {
  it("moves the composer above the software keyboard", () => {
    expect(getAndroidChatKeyboardAvoidingViewProps(96)).toEqual({
      behavior: "padding",
      keyboardVerticalOffset: 96,
    });
  });
});

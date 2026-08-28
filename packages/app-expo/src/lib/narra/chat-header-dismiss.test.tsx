import { readFileSync } from "node:fs";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  View: "View",
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
}));
vi.mock("@expo/ui/swift-ui", () => ({ Host: "Host", Image: "Symbol" }));
vi.mock("expo-glass-effect", () => ({
  GlassView: "GlassView",
  isLiquidGlassAvailable: () => true,
}));
vi.mock("@/components/ui/Icon", () => ({ ChevronLeftIcon: "BackIcon", XIcon: "CloseIcon" }));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("@/styles/theme", () => ({
  useTheme: () => ({ colors: { foreground: "#111" }, isDark: false }),
  bodyTypography: {},
  captionTypography: {},
  fontWeight: { semibold: "600" },
  titleFontFamily: "system",
}));

import { NarraChatHeader } from "@/components/chat/narra-chat-header";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
afterEach(() => {
  if (tree) act(() => tree.unmount());
});

describe("chat sheet close control", () => {
  it("renders the native xmark and dispatches closing from the whole button", () => {
    const close = vi.fn();
    act(() => {
      tree = create(
        <NarraChatHeader title="Губернатор" backIcon="xmark" backLabel="Закрыть" onBack={close} />,
      );
    });
    expect(tree.root.find((node) => String(node.type) === "Symbol").props.systemName).toBe("xmark");
    const button = tree.root.find(
      (node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Закрыть",
    );
    expect(button.props.accessibilityRole).toBe("button");
    act(() => button.props.onPress());
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("retains the back arrow for chat navigation inside an existing sheet", () => {
    act(() => {
      tree = create(<NarraChatHeader title="Губернатор" backLabel="Назад" onBack={vi.fn()} />);
    });
    expect(tree.root.find((node) => String(node.type) === "Symbol").props.systemName).toBe(
      "chevron.backward",
    );
  });

  it("uses a close action and sheet inset only for standalone iOS character chats", () => {
    const screen = readFileSync(
      new URL("../../screens/NarraCharacterChatScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(screen).toContain('const presentedAsSheet = Platform.OS === "ios" && !embedded');
    expect(screen).toContain('backIcon={presentedAsSheet ? "xmark" : "chevron.backward"}');
    expect(screen).toContain('presentedAsSheet ? t("common.close", "Закрыть")');
    expect(screen).toContain(
      "embedded || presentedAsSheet ? NARRA_CHAT_EMBEDDED_TOP_INSET : insets.top",
    );
    expect(screen).toContain("KeyboardController.dismiss({ animated: true, keepFocus: false })");
    expect(screen).toContain("navigation.goBack()");
  });
});

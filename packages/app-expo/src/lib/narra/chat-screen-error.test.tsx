import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  bookId: "a",
  activeId: "thread-a",
  error: new Error("503 provider secret-token") as Error | null,
  errorThreadId: "thread-a",
  streaming: false,
  retry: vi.fn(async (_config: unknown) => {}),
  send: vi.fn(async () => {}),
  toast: vi.fn(),
  threads: ["a", "b"].map((id) => ({ id: `thread-${id}`, bookId: id, messages: [], updatedAt: 1 })),
  config: { endpoint: "own-gateway", model: "server-owned" },
}));
vi.mock("react-native", () => ({
  View: "View", Pressable: "Pressable", Text: "Text", ScrollView: "ScrollView", TouchableOpacity: "TouchableOpacity",
  StyleSheet: { create: <T,>(value: T) => value, absoluteFill: {}, hairlineWidth: 1 },
  Animated: { View: "AnimatedView", Value: class { setValue() {} } },
}));
vi.mock("react-native-keyboard-controller", () => ({ KeyboardController: { dismiss: vi.fn() } }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0 }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({}), useRoute: () => ({ name: "BookChat", params: { bookId: runtime.bookId } }) }));
vi.mock("@/hooks", () => ({ useStreamingChat: () => ({ isStreaming: runtime.streaming, error: runtime.error, errorThreadId: runtime.errorThreadId, sendMessage: runtime.send, retryLastMessage: runtime.retry, stopStream: vi.fn() }) }));
vi.mock("@/hooks/use-responsive-layout", () => ({ useResponsiveLayout: () => ({ isTabletLandscape: false, width: 420, horizontalPadding: 16 }) }));
vi.mock("@/stores", () => ({
  useLibraryStore: (select: (s: unknown) => unknown) => select({ books: [] }),
  useNarraStore: (select: (s: unknown) => unknown) => select({ books: {} }),
}));
vi.mock("@/stores/chat-store", () => ({ useChatStore: (select: (s: unknown) => unknown) => select({
  threads: runtime.threads, initialized: true, getActiveThreadId: () => runtime.activeId,
  getThreadsForContext: (id: string) => runtime.threads.filter((thread) => thread.bookId === id),
  loadThreads: vi.fn(), setBookActiveThread: vi.fn(),
}) }));
vi.mock("@/stores/settings-store", () => ({ useSettingsStore: Object.assign((select: (s: unknown) => unknown) => select({ narraChatMode: "index-first" }), { getState: () => ({ aiConfig: {} }) }) }));
vi.mock("@/lib/ai/narra-assistant-gateway", () => ({ createNarraAssistantAIConfig: () => runtime.config }));
vi.mock("@/lib/ai/narra-book-search", () => ({ createNarraIndexedToolProvider: vi.fn() }));
vi.mock("@/lib/library/open-mobile-book", () => ({ openMobileBook: vi.fn() }));
vi.mock("@/lib/diagnostics/diagnostics", () => ({ recordDiagnostic: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ toast: { error: runtime.toast } }));
vi.mock("@readany/core/utils", () => ({ convertToMessageV2: () => [], mergeMessagesWithStreaming: () => [], formatRelativeTimeShort: vi.fn(), getMonthLabel: vi.fn(), groupThreadsByTime: () => ({ today: [], yesterday: [], last7Days: [], last30Days: [], older: [] }) }));
vi.mock("@/components/chat/NarraChat", () => ({ NarraChat: "Chat" }));
vi.mock("@/components/chat/animated-narra-face", () => ({ AnimatedNarraFace: "Face" }));
vi.mock("@/components/chat/narra-chat-header", () => ({ NarraChatHeader: "Header", NARRA_CHAT_EMBEDDED_TOP_INSET: 8, NARRA_CHAT_HEADER_HEIGHT: 48 }));
vi.mock("@/components/ui/Icon", () => ({ MessageCirclePlusIcon: "Icon", Trash2Icon: "Icon", XIcon: "Icon" }));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("@/styles/theme", () => ({ useColors: () => ({}), withOpacity: () => "transparent", fontSize: {}, fontWeight: {}, radius: {}, headingFontFamily: "system" }));
vi.mock("@deslop/primitives", () => ({ spacingPixels: { 8: 8, 16: 16 } }));

import { ChatScreen } from "@/screens/ChatScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
const alerts = () => tree.root.findAll((node) => node.props.accessibilityRole === "alert");
const retry = () => tree.root.find((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Повторить");
const render = async () => { await act(() => { tree = create(<ChatScreen embedded />); }); };
const update = async () => { await act(() => tree.update(<ChatScreen embedded />)); };
beforeEach(() => {
  vi.clearAllMocks(); runtime.bookId = "a"; runtime.activeId = "thread-a";
  runtime.error = new Error("503 provider secret-token"); runtime.errorThreadId = "thread-a"; runtime.streaming = false;
});
afterEach(() => { if (tree) act(() => tree.unmount()); });

describe("Narra screen durable error recovery", () => {
  it("renders a persistent safe inline error, retries with the existing gateway config and hides the old error immediately", async () => {
    await render();
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].props.children).toBe("Не удалось получить ответ");
    const visibleStrings = tree.root.findAll(() => true).flatMap((node) => [
      ...node.children.filter((child) => typeof child === "string"),
      node.props.accessibilityLabel,
    ]).filter((value) => typeof value === "string").join(" ");
    expect(visibleStrings).not.toContain("secret-token");
    expect(runtime.toast).not.toHaveBeenCalled();
    await act(async () => { await retry().props.onPress(); });
    expect(runtime.retry).toHaveBeenCalledExactlyOnceWith(runtime.config);
    expect(alerts()).toHaveLength(0);
    runtime.error = new Error("another failure"); await update();
    expect(alerts()).toHaveLength(1);
  });
  it("hides errors while streaming and when sending a new message", async () => {
    await render();
    runtime.streaming = true; await update(); expect(alerts()).toHaveLength(0);
    runtime.streaming = false; await update(); expect(alerts()).toHaveLength(1);
    await act(async () => tree.root.find((node) => String(node.type) === "Chat").props.onSend("own question", false, true));
    expect(runtime.send).toHaveBeenCalledOnce(); expect(alerts()).toHaveLength(0);
  });
  it("does not expose another thread's error or execute its stale retry after changing books", async () => {
    await render(); const oldRetry = retry().props.onPress;
    runtime.bookId = "b"; runtime.activeId = "thread-b"; await update();
    expect(alerts()).toHaveLength(0);
    await act(async () => oldRetry()); expect(runtime.retry).not.toHaveBeenCalled();
    // Even a stale active-id cannot expose book A's error in book B.
    runtime.activeId = "thread-a"; await update(); expect(alerts()).toHaveLength(0);
  });
});

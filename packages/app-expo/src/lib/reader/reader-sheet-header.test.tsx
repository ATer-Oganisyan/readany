import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({ os: "android", close: vi.fn() }));
vi.mock("@/components/ui/MishanaerIcon", () => ({ getStrokeIconImageSource: () => 1 }));
vi.mock("@/styles/theme", () => ({
  useTheme: () => ({ colors: { card: "white", foreground: "black" }, isDark: false }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@react-navigation/elements", () => ({ Header: "StackHeader" }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return ports.os;
    },
  },
  StyleSheet: { create: (styles: unknown) => styles },
  View: "View",
}));
vi.mock("../../screens/reader/ReaderTOCPanel", () => ({ ReaderTOCPanel: "TOC" }));
vi.mock("../../screens/reader/ReaderTOCSheetCloseButton", () => ({
  ReaderTOCSheetCloseButton: "Close",
}));
vi.mock("../../screens/reader/reader-bookmarks-panel", () => ({
  ReaderBookmarksPanel: "Bookmarks",
}));
vi.mock("../../screens/reader/reader-toc-sheet-context", () => ({
  useReaderTOCSheet: () => ({ session: { bookId: "book", onClose: ports.close } }),
}));
import { ReaderTOCSheetScreen } from "../../screens/reader/reader-toc-sheet-screen";
type ScreenProps = Parameters<typeof ReaderTOCSheetScreen>[0];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  vi.clearAllMocks();
});

it.each(["bookmarks", "toc"])(
  "provides Android sheet a rendered navigation header and Close for %s",
  async (tab) => {
    ports.os = "android";
    const navigation = { setOptions: vi.fn(), goBack: vi.fn() };
    const route = { params: { tab } };
    await act(async () => {
      tree = create(
        <ReaderTOCSheetScreen {...({ navigation, route } as unknown as ScreenProps)} />,
      );
    });
    const options = navigation.setOptions.mock.lastCall?.[0];
    // Native Android formSheet intentionally omits its toolbar; headerShown alone is insufficient.
    expect(options.header).toBeTypeOf("function");
    const header = options.header({ options, navigation, route });
    expect(header.type).toBe("StackHeader");
    expect(header.props.title).toBe(tab === "bookmarks" ? "bookmarks.title" : "reader.toc");
    expect(header.props.headerStatusBarHeight).toBe(0);
    header.props.headerRight({}).props.onPress();
    expect(ports.close).toHaveBeenCalledOnce();
  },
);

it("retains the native iOS navigation header", async () => {
  ports.os = "ios";
  const navigation = { setOptions: vi.fn(), goBack: vi.fn() };
  await act(async () => {
    tree = create(
      <ReaderTOCSheetScreen
        {...({ navigation, route: { params: { tab: "bookmarks" } } } as unknown as ScreenProps)}
      />,
    );
  });
  const options = navigation.setOptions.mock.lastCall?.[0];
  expect(options.header).toBeUndefined();
  expect(options.headerTitle).toBe("bookmarks.title");
  options.unstable_headerRightItems()[0].onPress();
  expect(ports.close).toHaveBeenCalledOnce();
});

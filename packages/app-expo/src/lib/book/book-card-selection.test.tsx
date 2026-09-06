import type { Book } from "@readany/core/types";
import { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  platform: "android",
  alert: vi.fn(),
  open: vi.fn(),
  remove: vi.fn(),
  canPress: vi.fn(() => true),
}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Image: "Image",
  Pressable: "Pressable",
  Alert: { alert: runtime.alert },
  StyleSheet: {
    create: (x: unknown) => x,
    absoluteFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  },
}));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("expo-blur", () => ({ BlurView: "BlurView" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("@/components/ui/Icon", () => ({ CheckIcon: "CheckIcon" }));
vi.mock("@/components/ui/HostedMishanaerIcon", () => ({ HostedMishanaerIcon: "HostedIcon" }));
vi.mock("@expo/ui/swift-ui", async () => {
  const React = await import("react");
  return {
    Button: "NativeButton",
    Host: "NativeHost",
    Label: "NativeLabel",
    RNHostView: "RNHostView",
    ContextMenu: Object.assign(
      ({ children }: { children: import("react").ReactNode }) =>
        React.createElement("ContextMenu", null, children),
      { Trigger: "MenuTrigger", Items: "MenuItems" },
    ),
  };
});
vi.mock("../../components/library/BookCardContextMenu", async (original) => {
  const android = await original<typeof import("../../components/library/BookCardContextMenu")>();
  const ios = await import("../../components/library/BookCardContextMenu.ios");
  const React = await import("react");
  return {
    BookCardContextMenu: (
      props: import("../../components/library/BookCardContextMenu.types").BookCardContextMenuProps,
    ) =>
      React.createElement(
        runtime.platform === "ios" ? ios.BookCardContextMenu : android.BookCardContextMenu,
        props,
      ),
  };
});
vi.mock("@/styles/theme", () => ({
  useColors: () => ({
    primary: "#111",
    primaryForeground: "#fff",
    background: "#fff",
    primary5: "#eee",
  }),
  radius: { sm: 6, full: 999 },
  fontSize: {},
  fontWeight: {},
  headingFontFamily: "own-font",
}));
vi.mock("@/components/ui/swipe-press-guard", () => ({
  useSwipePressGuard: () => ({ canPress: runtime.canPress }),
}));
vi.mock("@/lib/catalog/bundled-books", () => ({ findBundledCatalogBookByTitle: () => undefined }));
vi.mock("@/screens/notes/useResolvedCovers", () => ({ useResolvedCovers: () => new Map() }));
vi.mock("../../components/library/use-resolved-asset-uris", () => ({
  useResolvedAssetUris: () => new Map(),
}));
vi.mock("../../components/library/cover-press", () => ({ useCoverPress: () => ({}) }));
vi.mock("../../components/library/book-cover-typography", () => ({
  BookCoverTypography: "BookCoverTypography",
}));
vi.mock("../../components/library/book-spine-overlay", () => ({
  BookSpineOverlay: "BookSpineOverlay",
}));
import { BookCard } from "../../components/library/BookCard";

const books = ["own-one", "own-two"].map(
  (id) =>
    ({
      id,
      meta: { title: id, author: "Own" },
      progress: 0.63,
      filePath: `books/${id}.epub`,
      format: "epub",
    }) as Book,
);
let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  runtime.platform = "android";
  runtime.canPress.mockReturnValue(true);
});
afterEach(async () => {
  if (view) await act(() => view.unmount());
});
function LibrarySelectionHarness({ cardWidth = 96 }: { cardWidth?: number }) {
  const [selection, setSelection] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  return (
    <>
      <button
        onClick={() => {
          setSelection(false);
          setSelected(new Set());
        }}
      >
        cancel
      </button>
      {books.map((book) => (
        <BookCard
          key={book.id}
          book={book}
          onOpen={runtime.open}
          onDelete={runtime.remove}
          isSelectionMode={selection}
          cardWidth={cardWidth}
          isSelected={selected.has(book.id)}
          onLongPress={(picked) => {
            setSelection(true);
            setSelected(new Set([picked.id]));
          }}
          onSelect={(picked) =>
            setSelected((previous) => {
              const next = new Set(previous);
              if (next.has(picked.id)) next.delete(picked.id);
              else next.add(picked.id);
              return next;
            })
          }
        />
      ))}
    </>
  );
}
async function render(cardWidth = 96) {
  await act(() => {
    view = create(<LibrarySelectionHarness cardWidth={cardWidth} />);
  });
}
function menuButtons() {
  return runtime.alert.mock.calls.at(-1)![2] as Array<{ text: string; onPress?: () => void }>;
}
function overlays() {
  return view.root.findAll(
    (node) => String(node.type) === "Pressable" && typeof node.props.onLongPress === "function",
  );
}
function checkbox(title: string) {
  return view.root.findAll(
    (node) =>
      String(node.type) === "Pressable" &&
      node.props.accessibilityRole === "checkbox" &&
      node.props.accessibilityLabel === title,
  )[0];
}

it("native menu Select enters selection, taps toggle instead of open, Cancel restores normal behavior", async () => {
  await render();
  await act(() => overlays()[0].props.onLongPress());
  const select = menuButtons().find((button) => button.text === "Выбрать");
  expect(select).toBeDefined();
  await act(() => select!.onPress!());
  expect(checkbox("own-one").props.accessibilityState).toMatchObject({ checked: true });
  expect(checkbox("own-two").props.accessibilityState).toMatchObject({ checked: false });
  expect(overlays()).toHaveLength(0);
  await act(() => checkbox("own-two").props.onPress({}));
  expect(checkbox("own-two").props.accessibilityState.checked).toBe(true);
  await act(() => checkbox("own-one").props.onPress({}));
  expect(checkbox("own-one").props.accessibilityState.checked).toBe(false);
  expect(runtime.open).not.toHaveBeenCalled();
  expect(view.root.findAll((node) => String(node.type) === "CheckIcon")).toHaveLength(1);
  expect(view.root.findAll((node) => String(node.type) === "BookCoverTypography")).toHaveLength(2);
  await act(() => view.root.findByType("button").props.onClick());
  expect(checkbox("own-one")).toBeUndefined();
  await act(() => overlays()[0].props.onPress({}));
  expect(runtime.open).toHaveBeenCalledExactlyOnceWith(books[0]);
  await act(() => overlays()[0].props.onLongPress());
  await act(() => menuButtons().find((button) => button.text === "Выбрать")!.onPress!());
  expect(checkbox("own-two").props.accessibilityState.checked).toBe(false);
});

it("preserves ordinary open, destructive menu action and menu Cancel", async () => {
  await render();
  await act(() => overlays()[0].props.onPress({}));
  expect(runtime.open).toHaveBeenCalledExactlyOnceWith(books[0]);
  await act(() => overlays()[1].props.onLongPress());
  expect(menuButtons().find((button) => button.text === "Отмена")).toBeDefined();
  await act(() => menuButtons().find((button) => button.text === "Удалить")!.onPress!());
  expect(runtime.remove).toHaveBeenCalledExactlyOnceWith("own-two");
  expect(checkbox("own-one")).toBeUndefined();
});

it("keeps swipe suppression while selecting", async () => {
  await render();
  await act(() => overlays()[0].props.onLongPress());
  await act(() => menuButtons().find((button) => button.text === "Выбрать")!.onPress!());
  runtime.canPress.mockReturnValue(false);
  await act(() => checkbox("own-two").props.onPress({}));
  expect(checkbox("own-two").props.accessibilityState.checked).toBe(false);
  expect(runtime.open).not.toHaveBeenCalled();
});

it("places the rendered selection badge in the bottom-right accessory corner, outside title text", async () => {
  await render(192);
  await act(() => overlays()[0].props.onLongPress());
  await act(() => menuButtons().find((button) => button.text === "Выбрать")!.onPress!());
  const badge = view.root.findAll(
    (node) =>
      String(node.type) === "View" &&
      Array.isArray(node.props.style) &&
      node.props.style[0]?.zIndex === 30,
  )[0];
  const style = Object.assign({}, ...badge.props.style);
  expect(style).toMatchObject({ bottom: 8, right: 8, width: 26, height: 26 });
  expect(style.top).toBeUndefined();
  expect(style.left).toBeUndefined();
  const cover = badge.parent!.props.style;
  const badgeLeft = cover.width - style.right - style.width;
  const badgeTop = cover.height - style.bottom - style.height;
  expect(badgeLeft).toBeGreaterThan(cover.width / 2);
  expect(badgeTop).toBeGreaterThan(cover.height / 2);
  const progress = view.root.findAll((node) => String(node.type) === "BookCoverTypography")[0];
  expect(progress.props.bottomAccessory.props.children.props.children).toBe("63%");
});

it("iOS menu Select unwraps the native host for selection and restores it on Cancel without losing progress", async () => {
  runtime.platform = "ios";
  await render();
  const selects = view.root.findAll(
    (node) =>
      String(node.type) === "NativeButton" &&
      node.findAll(
        (child) => String(child.type) === "NativeLabel" && child.props.title === "Выбрать",
      ).length > 0,
  );
  expect(selects).toHaveLength(2);
  await act(() => selects[0].props.onPress());
  expect(view.root.findAll((node) => String(node.type) === "NativeHost")).toHaveLength(0);
  await act(() => checkbox("own-two").props.onPress({}));
  expect(checkbox("own-two").props.accessibilityState.checked).toBe(true);
  expect(runtime.open).not.toHaveBeenCalled();
  const progress = view.root
    .findAll((node) => String(node.type) === "BookCoverTypography")
    .map((node) => node.props.bottomAccessory.props.children.props.children);
  expect(progress).toEqual(["63%", "63%"]);
  await act(() => view.root.findByType("button").props.onClick());
  expect(view.root.findAll((node) => String(node.type) === "NativeHost")).toHaveLength(2);
  await act(() =>
    view.root
      .findAll(
        (node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "own-one",
      )[0]
      .props.onPress({}),
  );
  expect(runtime.open).toHaveBeenCalledExactlyOnceWith(books[0]);
});

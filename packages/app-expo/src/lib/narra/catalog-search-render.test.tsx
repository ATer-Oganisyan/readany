import type { Book } from "@readany/core/types";
import type * as React from "react";
import { type ReactTestInstance, type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedBackendCatalog, CachedBackendCatalogBook } from "./backend-catalog-cache";
import type { BookSearchResult } from "./catalog-search-results";
import type { CatalogShelf } from "./catalog-shelves";

interface SearchHeader {
  ref: { current: unknown };
  onChangeText: (event: { nativeEvent: { text: string } }) => void;
  onFocus: () => void;
  onCancelButtonPress: () => void;
}

interface CoverWindow {
  visible: CachedBackendCatalogBook[];
  nearby: CachedBackendCatalogBook[];
  active: boolean;
}

interface TestSnapshot {
  catalog: CachedBackendCatalog;
  isLoading: boolean;
  isRefreshing: boolean;
  hasCompleteCatalog: boolean;
  loadedCount: number;
  error: unknown | null;
  retry: () => Promise<void>;
  refresh: () => Promise<void>;
}

interface ListDoubleProps {
  data?: readonly unknown[];
  renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
  keyExtractor?: (item: unknown, index: number) => string;
  horizontal?: boolean;
  contentOffset?: { x: number; y: number };
  onScroll?: (event: { nativeEvent: { contentOffset: { x: number; y: number } } }) => void;
  ListHeaderComponent?: React.ReactNode | React.ComponentType;
  ListEmptyComponent?: React.ReactNode | React.ComponentType;
  ListFooterComponent?: React.ReactNode | React.ComponentType;
}

const runtime = vi.hoisted(() => ({
  counters: new Map<string, number>(),
  focused: true,
  focusListeners: new Set<() => void>(),
  navigationFocusListeners: new Set<() => void>(),
  libraryListeners: new Set<() => void>(),
  catalogListeners: new Set<() => void>(),
  keyboardListeners: new Map<string, (event: { endCoordinates: { height: number } }) => void>(),
  keyboardMetrics: undefined as { height: number } | undefined,
  library: { books: [] as Book[] },
  snapshot: null as TestSnapshot | null,
  header: null as SearchHeader | null,
  callOrder: [] as string[],
  nativeSearch: { blur: vi.fn(), setText: vi.fn(), cancelSearch: vi.fn() },
  navigation: {
    navigate: vi.fn<(name: string, params: unknown) => void>(),
    setOptions:
      vi.fn<(options: { headerSearchBarOptions?: SearchHeader; title?: string }) => void>(),
    isFocused: vi.fn<() => boolean>(),
    addListener: vi.fn<(name: string, listener: () => void) => () => void>(),
  },
  openMobileBook: vi.fn<(_options: { bookId: string }) => Promise<boolean>>(),
  retry: vi.fn<() => Promise<void>>(),
  refresh: vi.fn<() => Promise<void>>(),
  retryCover: vi.fn(),
  catalogActivity: vi.fn(),
  coverWindow: vi.fn<(_window: CoverWindow) => void>(),
  dismissKeyboard: vi.fn(),
  covers: new Map<string, string>(),
  t: (_key: string, fallback?: string) => fallback ?? _key,
  i18n: { resolvedLanguage: "ru" },
  theme: {
    colors: {
      background: "#fff",
      primary: "#000",
      primary5: "#eee",
      primary20: "#ccc",
      primary40: "#999",
      foreground: "#111",
      mutedForeground: "#777",
    },
    isDark: false,
  },
}));

vi.mock("react-native", async () => {
  const { createElement, Fragment, forwardRef, useImperativeHandle, useRef } = await import(
    "react"
  );
  const renderPart = (part: React.ReactNode | React.ComponentType) =>
    typeof part === "function" ? createElement(part) : part;

  // This double renders all data. It tests React identity, state, handlers and
  // actual row behavior, not native virtualization, pixels or frame timing.
  const FlatList = forwardRef(function ListDouble(props: ListDoubleProps, ref) {
    const position = useRef({
      x: props.contentOffset?.x ?? 0,
      y: props.contentOffset?.y ?? 0,
      scrollToOffsetCalls: [] as Array<{ offset: number; animated: boolean }>,
    }).current;
    useImperativeHandle(ref, () => ({
      scrollToOffset: (options: { offset: number; animated: boolean }) => {
        position.scrollToOffsetCalls.push(options);
        if (props.horizontal) position.x = options.offset;
        else position.y = options.offset;
      },
    }));
    const data = props.data ?? [];
    return createElement(
      "FlatList",
      {
        ...props,
        __position: position,
        onScroll: (event: { nativeEvent: { contentOffset: { x: number; y: number } } }) => {
          Object.assign(position, event.nativeEvent.contentOffset);
          props.onScroll?.(event);
        },
      },
      renderPart(props.ListHeaderComponent),
      data.length
        ? data.map((item, index) =>
            createElement(
              Fragment,
              { key: props.keyExtractor?.(item, index) ?? index },
              props.renderItem?.({ item, index }),
            ),
          )
        : renderPart(props.ListEmptyComponent),
      renderPart(props.ListFooterComponent),
    );
  });

  return {
    FlatList,
    View: "View",
    Image: "Image",
    Pressable: "Pressable",
    TouchableOpacity: "TouchableOpacity",
    ActivityIndicator: "ActivityIndicator",
    Keyboard: {
      dismiss: runtime.dismissKeyboard,
      metrics: () => runtime.keyboardMetrics,
      addListener: (
        event: string,
        listener: (event: { endCoordinates: { height: number } }) => void,
      ) => {
        runtime.keyboardListeners.set(event, listener);
        return { remove: () => runtime.keyboardListeners.delete(event) };
      },
    },
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      absoluteFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
      hairlineWidth: 0.5,
    },
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
  };
});
vi.mock("@react-navigation/native", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useNavigation: () => runtime.navigation,
    useIsFocused: () =>
      useSyncExternalStore(
        (listener) => {
          runtime.focusListeners.add(listener);
          return () => runtime.focusListeners.delete(listener);
        },
        () => runtime.focused,
      ),
  };
});
vi.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 88 }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}));
vi.mock("@/stores", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useLibraryStore: <T,>(selector: (state: typeof runtime.library) => T) =>
      useSyncExternalStore(
        (listener) => {
          runtime.libraryListeners.add(listener);
          return () => runtime.libraryListeners.delete(listener);
        },
        () => selector(runtime.library),
      ),
  };
});
vi.mock("@/hooks/use-backend-catalog", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useBackendCatalog: () =>
      useSyncExternalStore(
        (listener) => {
          runtime.catalogListeners.add(listener);
          return () => runtime.catalogListeners.delete(listener);
        },
        () => runtime.snapshot,
      ),
    useBackendCatalogActivity: runtime.catalogActivity,
  };
});
vi.mock("@/hooks/use-catalog-cover-window", () => ({
  useCatalogCoverWindow: runtime.coverWindow,
}));
vi.mock("@/screens/notes/useResolvedCovers", () => ({ useResolvedCovers: () => runtime.covers }));
vi.mock("@/lib/library/open-mobile-book", () => ({ openMobileBook: runtime.openMobileBook }));
vi.mock("@/lib/narra/catalog-cover-coordinator", () => ({ retryCatalogCover: runtime.retryCover }));
vi.mock("@/lib/diagnostics/interaction-performance", () => ({
  countRender: (name: string) => runtime.counters.set(name, (runtime.counters.get(name) ?? 0) + 1),
  markInteraction: vi.fn(),
}));
vi.mock("@/styles/theme", () => ({
  useTheme: () => runtime.theme,
  useColors: () => runtime.theme.colors,
  radius: { sm: 6, full: 9999 },
  spacing: { sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
  fontSize: { base: 16, xl: 20 },
  fontWeight: { semibold: "600", normal: "400" },
  largeTitleFontFamily: "SB Serif Condensed Regular",
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: runtime.t, i18n: runtime.i18n }),
}));
vi.mock("@deslop/primitives/native", () => ({
  interfaceFontFamily: { semibold: "SB Sans Interface Semibold" },
  serifTextFontFamily: { regular: "SB Serif Text" },
}));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("@/components/ui/NativeButton", () => ({ NativeButton: "NativeButton" }));
vi.mock("@/components/ui/MishanaerIcon", () => ({ MishanaerIcon: "MishanaerIcon" }));
vi.mock("@/components/ui/centered-empty-state", () => ({
  CenteredEmptyState: "CenteredEmptyState",
}));
vi.mock("@/lib/book/cover-text-contrast", () => ({ generatedCoverTextTone: () => "dark" }));
vi.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
vi.mock("react-native-gesture-handler", () => ({ GestureDetector: "GestureDetector" }));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("../../components/library/cover-press", () => ({
  useCoverPress: () => ({ pressStyle: {}, gesture: {} }),
}));
vi.mock("../../components/library/use-cover-foreground", () => ({
  useCoverForeground: () => ({ primary: "#fff", secondary: "#ddd" }),
}));

import { SearchScreen } from "../../screens/SearchScreen";
import { CatalogCategoryScreen } from "../../screens/catalog-category-screen";
import { catalogCoverStore } from "./catalog-cover-store";

let renderer: ReactTestRenderer | undefined;
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

beforeEach(() => {
  vi.stubEnv("EXPO_OS", "ios");
  runtime.counters.clear();
  runtime.callOrder = [];
  runtime.focused = true;
  runtime.header = null;
  runtime.keyboardMetrics = undefined;
  runtime.library = { books: [] };
  runtime.nativeSearch.blur.mockReset().mockImplementation(() => runtime.callOrder.push("blur"));
  runtime.nativeSearch.setText.mockReset();
  runtime.nativeSearch.cancelSearch.mockReset();
  runtime.navigation.navigate.mockReset().mockImplementation((name) => {
    runtime.callOrder.push(`navigate:${name}`);
  });
  runtime.navigation.setOptions.mockReset().mockImplementation((options) => {
    if (!options.headerSearchBarOptions) return;
    runtime.header = options.headerSearchBarOptions;
    runtime.header.ref.current = runtime.nativeSearch;
  });
  runtime.navigation.isFocused.mockReset().mockImplementation(() => runtime.focused);
  runtime.navigation.addListener.mockReset().mockImplementation((name, listener) => {
    if (name !== "focus") throw new Error(`Unexpected navigation listener: ${name}`);
    runtime.navigationFocusListeners.add(listener);
    return () => runtime.navigationFocusListeners.delete(listener);
  });
  runtime.openMobileBook.mockReset().mockImplementation(async () => {
    runtime.callOrder.push("openLocal");
    return true;
  });
  runtime.retry.mockReset().mockResolvedValue();
  runtime.refresh.mockReset().mockResolvedValue();
  runtime.retryCover.mockClear();
  runtime.coverWindow.mockClear();
  runtime.catalogActivity.mockClear();
  runtime.dismissKeyboard.mockClear();
  runtime.covers.clear();
  runtime.snapshot = {
    catalog: { books: [], genres: [], genreVersion: "test-v1", nextCursor: null },
    isLoading: false,
    isRefreshing: false,
    loadedCount: 0,
    hasCompleteCatalog: true,
    error: null,
    retry: runtime.retry,
    refresh: runtime.refresh,
  };
});

afterEach(async () => {
  if (renderer) await act(() => renderer?.unmount());
  renderer = undefined;
  catalogCoverStore.retainBooks([]);
  expect(runtime.focusListeners.size).toBe(0);
  expect(runtime.navigationFocusListeners.size).toBe(0);
  expect(runtime.libraryListeners.size).toBe(0);
  expect(runtime.catalogListeners.size).toBe(0);
  expect(runtime.keyboardListeners.size).toBe(0);
  vi.unstubAllEnvs();
});

async function render(element: React.ReactElement) {
  await act(() => {
    renderer = create(element);
  });
  if (!renderer) throw new Error("Expected mounted search renderer");
  return renderer;
}

function hosts(root: ReactTestInstance, name: string) {
  return root.findAll((node) => node.type === name);
}

function count(name: string) {
  return runtime.counters.get(name) ?? 0;
}

function header() {
  if (!runtime.header) throw new Error("Search did not configure its native header");
  return runtime.header;
}

function snapshot() {
  if (!runtime.snapshot) throw new Error("Missing catalog fixture");
  return runtime.snapshot;
}

function discovery(root: ReactTestInstance) {
  const list = hosts(root, "FlatList").find(
    (node) => !node.props.horizontal && node.props.testID !== "search-results-list",
  );
  if (!list) throw new Error("Expected mounted discovery list");
  return list;
}

function resultsList(root: ReactTestInstance) {
  const result = hosts(root, "FlatList").find(
    (node) => node.props.testID === "search-results-list",
  );
  if (!result) throw new Error("Expected mounted search results");
  return result;
}

function resultKeys(root: ReactTestInstance) {
  return (resultsList(root).props.data as BookSearchResult[]).map(({ key }) => key);
}

function latestCoverWindow() {
  const call = runtime.coverWindow.mock.calls.at(-1);
  if (!call) throw new Error("Expected cover window");
  return call[0];
}

async function input(text: string) {
  await act(() => header().onChangeText({ nativeEvent: { text } }));
}

async function focus(value: boolean) {
  await act(() => {
    runtime.focused = value;
    for (const listener of runtime.focusListeners) listener();
    if (value) for (const listener of runtime.navigationFocusListeners) listener();
  });
}

// New event objects intentionally prevent the gesture guard's duplicate-event
// filter from making a navigation latch test pass on its own.
function activation() {
  return { nativeEvent: {} };
}

function catalogBook(id: string, title: string, author = "Test author", genre = "fiction") {
  return {
    resolution: "catalog",
    bookEditionId: id,
    catalogKey: `catalog-${id}`,
    title,
    author,
    genres: [genre],
    format: "epub",
    contentSha256: "a".repeat(64),
    generationStatus: "ready",
    ready: true,
    sourceDownloadPath: `/v2/books/${id}/source`,
    cover: {
      contentHash: "b".repeat(64),
      byteSize: 10,
      mimeType: "image/jpeg",
      downloadPath: `/v2/books/${id}/cover`,
    },
    coverUri: `file:///${id}.jpg`,
  } satisfies CachedBackendCatalogBook;
}

function localBook(id: string, title: string, author: string): Book {
  return {
    id,
    meta: { title, author },
    filePath: `${id}.epub`,
    format: "epub",
    progress: 0,
    addedAt: 1,
    updatedAt: 1,
    isVectorized: false,
    vectorizeProgress: 0,
    tags: [],
    syncStatus: "local",
  };
}

function seedCatalog() {
  const books = [
    catalogBook("war", "Война и мир", "Лев Толстой"),
    catalogBook("hobbit", "The Hobbit", "J. R. R. Tolkien"),
    catalogBook("dune", "Dune", "Frank Herbert"),
    catalogBook("1984", "1984", "George Orwell"),
    catalogBook("five", "Fifth book"),
    catalogBook("six", "Sixth book"),
    catalogBook("notes", "Заметки", "Test author", "essays"),
    catalogBook("memoir", "Memoir", "Test author", "essays"),
  ];
  runtime.snapshot = {
    ...snapshot(),
    loadedCount: books.length,
    catalog: {
      books,
      nextCursor: null,
      genreVersion: "test-v1",
      genres: [
        { id: "fiction", labelRu: "Художественная литература", labelEn: "Fiction", order: 1 },
        { id: "essays", labelRu: "Эссе", labelEn: "Essays", order: 2 },
      ],
    },
  };
  runtime.library = {
    books: [
      {
        ...localBook("imported-hobbit", "The Hobbit", "J. R. R. Tolkien"),
        sourceKind: "catalog",
        bookEditionId: "hobbit",
      },
      localBook("local", "Местная книга", "Местный автор"),
    ],
  };
  catalogCoverStore.retainBooks(books);
  return books;
}

async function decodeImages(root: ReactTestInstance) {
  await act(() => {
    for (const node of hosts(root, "Image")) node.props.onLoad?.();
  });
}

describe("Search screen behavior with native boundaries replaced", () => {
  it("retains discovery pages and scroll state while focus changes rebuild no heavy content", async () => {
    seedCatalog();
    const mounted = await render(<SearchScreen />);
    const list = discovery(mounted.root);
    const shelf = hosts(list, "FlatList").find((node) => node.props.horizontal);
    if (!shelf) throw new Error("Expected a shelf list");
    const firstShelf = (list.props.data as CatalogShelf[])[0];
    await act(() => {
      list.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 380 } } });
      list.props.onViewableItemsChanged({ viewableItems: [{ item: firstShelf }] });
      shelf.props.onScroll({
        nativeEvent: { contentOffset: { x: shelf.props.snapToInterval, y: 0 } },
      });
    });
    const window = latestCoverWindow();
    expect(window.visible.map((book) => book.bookEditionId)).toEqual(["dune", "1984"]);
    const horizontalPosition = shelf.props.__position;
    const verticalPosition = list.props.__position;
    runtime.counters.clear();

    for (let i = 0; i < 5; i++) {
      await focus(false);
      expect(latestCoverWindow().active).toBe(false);
      await focus(true);
    }

    expect(count("search.screen")).toBe(0);
    expect(count("catalog.group")).toBe(0);
    expect(count("search.shelf")).toBe(0);
    expect(count("catalog.card")).toBe(0);
    expect(discovery(mounted.root)).toBe(list);
    expect(shelf.props.__position).toBe(horizontalPosition);
    expect(list.props.__position).toBe(verticalPosition);
    expect(verticalPosition.y).toBe(380);
    expect(latestCoverWindow().visible).toBe(window.visible);

    await input("Dune");
    expect(discovery(mounted.root)).toBe(list);
    expect(resultKeys(mounted.root)).toEqual(["catalog:dune"]);
    await input("");
    expect(discovery(mounted.root)).toBe(list);
    expect(shelf.props.__position).toBe(horizontalPosition);
    expect(horizontalPosition.x).toBe(shelf.props.snapToInterval);
    expect(verticalPosition.y).toBe(380);
    expect(latestCoverWindow().visible).toBe(window.visible);
    expect(
      hosts(mounted.root, "FlatList").some((node) => node.props.testID === "search-results-list"),
    ).toBe(false);
  });

  it("blurs the native search bar before opening one category for two separate activations", async () => {
    seedCatalog();
    const mounted = await render(<SearchScreen />);
    const link = hosts(mounted.root, "Pressable").find(
      (node) => node.props.testID === "catalog-category-link-fiction",
    );
    if (!link) throw new Error("Expected category action");
    await act(() => {
      link.props.onPress(activation());
      link.props.onPress(activation());
    });
    expect(runtime.callOrder).toEqual(["blur", "navigate:CatalogCategory"]);
    expect(runtime.navigation.navigate).toHaveBeenCalledExactlyOnceWith("CatalogCategory", {
      genreId: "fiction",
      title: "Художественная литература",
    });
    expect(runtime.nativeSearch.cancelSearch).not.toHaveBeenCalled();
    expect(runtime.dismissKeyboard).not.toHaveBeenCalled();
  });

  it("preserves a cancelled query through the native empty-change event and accepts an explicit later clear", async () => {
    seedCatalog();
    const mounted = await render(<SearchScreen />);
    await input("  ЛЕВ ТОЛСТОЙ  ");
    const results = resultsList(mounted.root);
    expect(resultKeys(mounted.root)).toEqual(["catalog:war"]);
    await act(() => {
      header().onCancelButtonPress();
      header().onChangeText({ nativeEvent: { text: "" } });
    });
    expect(resultsList(mounted.root)).toBe(results);
    expect(resultKeys(mounted.root)).toEqual(["catalog:war"]);
    expect(runtime.nativeSearch.setText).toHaveBeenLastCalledWith("  ЛЕВ ТОЛСТОЙ  ");
    expect(runtime.nativeSearch.blur).toHaveBeenCalledOnce();
    await act(() => header().onFocus());
    expect(runtime.nativeSearch.setText).toHaveBeenLastCalledWith("  ЛЕВ ТОЛСТОЙ  ");
    await input("");
    expect(
      hosts(mounted.root, "FlatList").some((node) => node.props.testID === "search-results-list"),
    ).toBe(false);
    expect(runtime.nativeSearch.cancelSearch).not.toHaveBeenCalled();
  });

  it("publishes only the latest pasted query, handles both languages and shows a real empty result", async () => {
    seedCatalog();
    const mounted = await render(<SearchScreen />);
    await act(() => {
      for (const text of ["The H", "not found", "  DUNE  "])
        header().onChangeText({ nativeEvent: { text } });
    });
    expect(resultKeys(mounted.root)).toEqual(["catalog:dune"]);
    await input("ВОЙНА");
    expect(resultKeys(mounted.root)).toEqual(["catalog:war"]);
    await input("not present in this catalog");
    expect(resultKeys(mounted.root)).toEqual([]);
    expect(hosts(resultsList(mounted.root), "CenteredEmptyState")[0].props.title).toBe(
      "Ничего не найдено",
    );
    expect(latestCoverWindow().visible).toEqual([]);
    expect(latestCoverWindow().nearby).toEqual([]);
  });

  it("retains result position on focus, but resets it for a new query", async () => {
    seedCatalog();
    const mounted = await render(<SearchScreen />);
    await input("book");
    const results = resultsList(mounted.root);
    await act(() => {
      results.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 170 } } });
    });
    const position = results.props.__position;
    const resets = position.scrollToOffsetCalls.length;
    runtime.counters.clear();
    await focus(false);
    await focus(true);
    expect(resultsList(mounted.root)).toBe(results);
    expect(position.y).toBe(170);
    expect(position.scrollToOffsetCalls).toHaveLength(resets);
    expect(count("search.screen")).toBe(0);
    expect(count("search.results.build")).toBe(0);
    expect(count("chats.row")).toBe(0);
    await input("Dune");
    expect(resultKeys(mounted.root)).toEqual(["catalog:dune"]);
    expect(position.y).toBe(0);
    expect(position.scrollToOffsetCalls).toHaveLength(resets + 1);
  });

  it("opens an imported result only once through its local book and retains the query on return", async () => {
    seedCatalog();
    const mounted = await render(<SearchScreen />);
    await input("hobbit");
    expect(resultKeys(mounted.root)).toEqual(["library:imported-hobbit"]);
    const row = hosts(resultsList(mounted.root), "TouchableOpacity")[0];
    await act(() => {
      row.props.onPress(activation());
      row.props.onPress(activation());
    });
    expect(runtime.callOrder).toEqual(["blur", "openLocal"]);
    expect(runtime.openMobileBook).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ bookId: "imported-hobbit" }),
    );
    expect(runtime.navigation.navigate).not.toHaveBeenCalled();
    await focus(false);
    await focus(true);
    await act(() => header().onFocus());
    expect(runtime.nativeSearch.setText).toHaveBeenLastCalledWith("hobbit");
    expect(resultKeys(mounted.root)).toEqual(["library:imported-hobbit"]);
  });

  it("updates only the completed cover's row and opens the latest catalog cover once", async () => {
    const books = seedCatalog();
    const mounted = await render(<SearchScreen />);
    await input("dune");
    const metadata = snapshot().catalog.books;
    runtime.counters.clear();
    await act(() => catalogCoverStore.setResult(books[2], "file:///fresh-dune.jpg"));
    expect(snapshot().catalog.books).toBe(metadata);
    expect(count("search.screen")).toBe(0);
    expect(count("catalog.group")).toBe(0);
    expect(count("search.shelf")).toBe(0);
    expect(count("search.results.build")).toBe(0);
    expect(count("chats.row")).toBe(1);
    expect(count("catalog.card")).toBe(1);
    const row = hosts(resultsList(mounted.root), "TouchableOpacity")[0];
    await act(() => {
      row.props.onPress(activation());
      row.props.onPress(activation());
    });
    expect(runtime.callOrder).toEqual(["blur", "navigate:Reader"]);
    expect(runtime.navigation.navigate).toHaveBeenCalledExactlyOnceWith("Reader", {
      bookId: "",
      catalogBook: expect.objectContaining({
        bookEditionId: "dune",
        coverUri: "file:///fresh-dune.jpg",
      }),
    });
    expect(runtime.openMobileBook).not.toHaveBeenCalled();
    expect(runtime.nativeSearch.cancelSearch).not.toHaveBeenCalled();
  });

  it("keeps an in-flight local open locked across focus return in Search", async () => {
    seedCatalog();
    const pending: Array<(opened: boolean) => void> = [];
    runtime.openMobileBook.mockImplementation(
      () => new Promise<boolean>((resolve) => pending.push(resolve)),
    );
    const mounted = await render(<SearchScreen />);
    await input("hobbit");
    const row = hosts(resultsList(mounted.root), "TouchableOpacity")[0];
    await act(() => row.props.onPress(activation()));
    await focus(false);
    await focus(true);
    await act(() => row.props.onPress(activation()));
    const requestedOpens = runtime.openMobileBook.mock.calls.length;
    await act(() => {
      for (const resolve of pending) resolve(false);
    });
    expect(requestedOpens).toBe(1);
    runtime.openMobileBook.mockResolvedValue(false);
    await act(() => row.props.onPress(activation()));
    expect(runtime.openMobileBook).toHaveBeenCalledTimes(2);
  });

  it("allows another deliberate activation after opening a local book failed", async () => {
    seedCatalog();
    runtime.openMobileBook.mockResolvedValueOnce(false);
    const mounted = await render(<SearchScreen />);
    await input("Местная");
    const row = hosts(resultsList(mounted.root), "TouchableOpacity")[0];
    await act(() => row.props.onPress(activation()));
    await act(() => row.props.onPress(activation()));
    expect(runtime.openMobileBook).toHaveBeenCalledTimes(2);
    expect(runtime.openMobileBook).toHaveBeenLastCalledWith(
      expect.objectContaining({ bookId: "local" }),
    );
    expect(runtime.navigation.navigate).not.toHaveBeenCalled();
  });

  it("adjusts no-results padding from software keyboard events and cleans up its listeners", async () => {
    seedCatalog();
    const mounted = await render(<SearchScreen />);
    await input("not present");
    const list = resultsList(mounted.root);
    await act(() =>
      runtime.keyboardListeners.get("keyboardWillChangeFrame")?.({
        endCoordinates: { height: 300 },
      }),
    );
    expect(list.props.contentContainerStyle).toContainEqual({ paddingBottom: 420 });
    await act(() =>
      runtime.keyboardListeners.get("keyboardWillHide")?.({ endCoordinates: { height: 0 } }),
    );
    expect(list.props.contentContainerStyle).not.toContainEqual({ paddingBottom: 420 });
    await input("");
    expect(runtime.keyboardListeners.size).toBe(0);
  });

  it("keeps an empty first result above a keyboard already shown before typing", async () => {
    seedCatalog();
    const mounted = await render(<SearchScreen />);
    runtime.keyboardMetrics = { height: 300 };
    expect(runtime.keyboardListeners.size).toBe(0);

    await input("not present");

    expect(resultsList(mounted.root).props.contentContainerStyle).toContainEqual({
      paddingBottom: 420,
    });
  });

  it("receives keyboard completion when results mount after the opening animation began", async () => {
    seedCatalog();
    const mounted = await render(<SearchScreen />);
    await input("not present");
    const list = resultsList(mounted.root);
    expect(list.props.contentContainerStyle).not.toContainEqual({ paddingBottom: 420 });

    await act(() => {
      runtime.keyboardMetrics = { height: 300 };
      runtime.keyboardListeners.get("keyboardDidShow")?.({
        endCoordinates: { height: 300 },
      });
    });

    expect(list.props.contentContainerStyle).toContainEqual({ paddingBottom: 420 });
  });

  it("drops the previous keyboard height when results mount during its closing animation", async () => {
    seedCatalog();
    const mounted = await render(<SearchScreen />);
    runtime.keyboardMetrics = { height: 300 };
    await input("not present");
    const list = resultsList(mounted.root);
    expect(list.props.contentContainerStyle).toContainEqual({ paddingBottom: 420 });

    await act(() => {
      runtime.keyboardMetrics = undefined;
      runtime.keyboardListeners.get("keyboardDidHide")?.({
        endCoordinates: { height: 300 },
      });
    });

    expect(list.props.contentContainerStyle).not.toContainEqual({ paddingBottom: 420 });
  });

  it("shows an empty catalog failure and calls its existing retry action", async () => {
    runtime.snapshot = { ...snapshot(), hasCompleteCatalog: false, error: new Error("offline") };
    const mounted = await render(<SearchScreen />);
    const list = discovery(mounted.root);
    expect(list.props.data).toEqual([]);
    expect(hosts(list, "CenteredEmptyState")[0].props.title).toBe("Не удалось загрузить каталог");
    const retry = hosts(list, "NativeButton")[0];
    await act(() => retry.props.onPress());
    expect(runtime.retry).toHaveBeenCalledOnce();
    expect(runtime.refresh).not.toHaveBeenCalled();
  });

  it("clears the shared Retry footer without rerendering complete-catalog shelves", async () => {
    seedCatalog();
    runtime.snapshot = { ...snapshot(), error: new Error("offline") };
    const mounted = await render(<SearchScreen />);
    const list = discovery(mounted.root);
    expect(hosts(list, "NativeButton").some((node) => node.props.label === "Повторить")).toBe(true);
    runtime.counters.clear();

    await act(() => {
      runtime.snapshot = { ...snapshot(), error: null, isRefreshing: true, loadedCount: 0 };
      for (const listener of runtime.catalogListeners) listener();
    });

    expect(hosts(list, "NativeButton").some((node) => node.props.label === "Повторить")).toBe(
      false,
    );
    expect(count("catalog.group")).toBe(0);
    expect(count("search.shelf")).toBe(0);
    expect(count("catalog.card")).toBe(0);
  });

  it("keeps a pending-page shelf error visible and updates it after Retry clears the error", async () => {
    seedCatalog();
    runtime.snapshot = {
      ...snapshot(),
      catalog: { ...snapshot().catalog, nextCursor: "fixture-next" },
      error: new Error("offline"),
    };
    const mounted = await render(<SearchScreen />);
    const list = discovery(mounted.root);
    const shelf = hosts(list, "FlatList").find((node) => node.props.horizontal);
    if (!shelf) throw new Error("Expected shelf with a pending catalog page");
    const retry = hosts(shelf, "NativeButton").find((node) => node.props.label === "Повторить");
    if (!retry) throw new Error("Expected the shelf's Retry action");
    expect(
      hosts(shelf, "Text").some(
        (node) => node.props.children === "Не удалось загрузить следующие книги",
      ),
    ).toBe(true);
    await act(() => retry.props.onPress());
    expect(runtime.retry).toHaveBeenCalledOnce();
    runtime.counters.clear();

    await act(() => {
      runtime.snapshot = { ...snapshot(), error: null };
      for (const listener of runtime.catalogListeners) listener();
    });

    expect(count("search.shelf")).toBe((list.props.data as CatalogShelf[]).length);
    expect(hosts(shelf, "NativeButton").some((node) => node.props.label === "Загрузить ещё")).toBe(
      true,
    );
    expect(
      hosts(shelf, "Text").some(
        (node) => node.props.children === "Не удалось загрузить следующие книги",
      ),
    ).toBe(false);
  });
});

describe("Category screen behavior with native boundaries replaced", () => {
  function categoryElement() {
    const props = {
      navigation: runtime.navigation,
      route: {
        key: "fiction",
        name: "CatalogCategory",
        params: { genreId: "fiction", title: "Fiction" },
      },
    } as unknown as React.ComponentProps<typeof CatalogCategoryScreen>;
    return <CatalogCategoryScreen {...props} />;
  }

  function grid(root: ReactTestInstance) {
    const list = hosts(root, "FlatList").find(
      (node) => node.props.testID === "catalog-category-grid",
    );
    if (!list) throw new Error("Expected category grid");
    return list;
  }

  it("responds to measured viewport height and retains the same grid through focus-only transitions", async () => {
    seedCatalog();
    const mounted = await render(categoryElement());
    const list = grid(mounted.root);
    const initialRows = list.props.initialNumToRender;
    await act(() => {
      list.props.onLayout({ nativeEvent: { layout: { width: 393, height: 480 } } });
      list.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 600 } } });
    });
    expect(list.props.initialNumToRender).toBeLessThan(initialRows);
    const data = list.props.data as CachedBackendCatalogBook[];
    await act(() =>
      list.props.onViewableItemsChanged({ viewableItems: [{ item: data[2] }, { item: data[3] }] }),
    );
    expect(latestCoverWindow().visible.map((book) => book.bookEditionId)).toEqual(["dune", "1984"]);
    const window = latestCoverWindow();
    const position = list.props.__position;
    runtime.counters.clear();
    await focus(false);
    expect(latestCoverWindow().active).toBe(false);
    await focus(true);
    expect(grid(mounted.root)).toBe(list);
    expect(list.props.__position).toBe(position);
    expect(position.y).toBe(600);
    expect(latestCoverWindow().visible).toBe(window.visible);
    expect(count("catalog.category")).toBe(0);
    expect(count("catalog.group")).toBe(0);
    expect(count("catalog.card")).toBe(0);
  });

  it("keeps an in-flight local open locked across focus return in Category", async () => {
    seedCatalog();
    const pending: Array<(opened: boolean) => void> = [];
    runtime.openMobileBook.mockImplementation(
      () => new Promise<boolean>((resolve) => pending.push(resolve)),
    );
    const mounted = await render(categoryElement());
    await decodeImages(mounted.root);
    const imported = hosts(grid(mounted.root), "Pressable").find(
      (node) => node.props.accessibilityLabel === "The Hobbit",
    );
    if (!imported) throw new Error("Expected imported book action");
    await act(() => imported.props.onPress(activation()));
    await focus(false);
    await focus(true);
    await act(() => imported.props.onPress(activation()));
    const requestedOpens = runtime.openMobileBook.mock.calls.length;
    await act(() => {
      for (const resolve of pending) resolve(false);
    });
    expect(requestedOpens).toBe(1);
    runtime.openMobileBook.mockResolvedValue(false);
    await act(() => imported.props.onPress(activation()));
    expect(runtime.openMobileBook).toHaveBeenCalledTimes(2);
  });

  it("opens imported and new category books through their respective route once per return", async () => {
    seedCatalog();
    const mounted = await render(categoryElement());
    await decodeImages(mounted.root);
    const imported = hosts(grid(mounted.root), "Pressable").find(
      (node) => node.props.accessibilityLabel === "The Hobbit",
    );
    const fresh = hosts(grid(mounted.root), "Pressable").find(
      (node) => node.props.accessibilityLabel === "Dune",
    );
    if (!imported || !fresh) throw new Error("Expected ready category book actions");
    await act(() => {
      imported.props.onPress(activation());
      imported.props.onPress(activation());
    });
    expect(runtime.openMobileBook).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ bookId: "imported-hobbit" }),
    );
    expect(runtime.navigation.navigate).not.toHaveBeenCalled();
    await focus(false);
    await focus(true);
    await act(() => {
      fresh.props.onPress(activation());
      fresh.props.onPress(activation());
    });
    expect(runtime.navigation.navigate).toHaveBeenCalledExactlyOnceWith("Reader", {
      bookId: "",
      catalogBook: expect.objectContaining({ bookEditionId: "dune" }),
    });
  });
});

import type { Book } from "@readany/core/types";
import type * as React from "react";
import { useCallback } from "react";
import { View } from "react-native";
import { type ReactTestInstance, type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import type { CachedBackendCatalogBook } from "./backend-catalog-cache";
import type { NarraBookState, NarraCharacter } from "./types";

const runtime = vi.hoisted(() => ({
  counters: new Map<string, number>(),
  focused: true,
  focusListeners: new Set<() => void>(),
  libraryListeners: new Set<() => void>(),
  narraListeners: new Set<() => void>(),
  library: { books: [] as Book[] },
  narra: {
    books: {} as Record<string, NarraBookState>,
    setCharacters: vi.fn(),
    updateCharacter: vi.fn(),
  },
  navigation: { navigate: vi.fn(), getParent: vi.fn() },
  guard: { canPress: vi.fn(() => true) },
  ensurePortrait: vi.fn(() => Promise.resolve("file:///new-portrait")),
  persistedSets: vi.fn(),
  foreground: vi.fn((_uri?: string, _tone?: string) => ({ primary: "#fff", secondary: "#ddd" })),
  t: (_key: string, fallback?: string) => fallback ?? _key,
  theme: {
    colors: {
      background: "#fff",
      primary: "#000",
      primary5: "#eee",
      primary20: "#ccc",
      primary30: "#bbb",
      foreground: "#111",
      mutedForeground: "#777",
    },
    isDark: false,
  },
}));

vi.mock("react-native", () => ({
  View: "View",
  Image: "Image",
  Pressable: "Pressable",
  TouchableOpacity: "TouchableOpacity",
  ScrollView: "ScrollView",
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    absoluteFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
    hairlineWidth: 0.5,
  },
  useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}));
vi.mock("@/styles/theme", () => ({
  useTheme: () => runtime.theme,
  useColors: () => runtime.theme.colors,
  radius: { sm: 6, full: 9999 },
  spacing: { sm: 8, md: 12, lg: 16, xxl: 24 },
  fontSize: { base: 16 },
  fontWeight: { semibold: "600" },
}));
vi.mock("@deslop/primitives/native", () => ({
  interfaceFontFamily: { semibold: "SB Sans Interface Semibold" },
  serifTextFontFamily: { regular: "SB Serif Text" },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: runtime.t }) }));
vi.mock("@/lib/notifications", () => ({ toast: { error: vi.fn() } }));
vi.mock("@readany/core/services", () => ({ getPlatformService: vi.fn() }));
vi.mock("@/lib/diagnostics/interaction-performance", () => ({
  countRender: (name: string) => runtime.counters.set(name, (runtime.counters.get(name) ?? 0) + 1),
}));
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
    useNarraStore: <T,>(selector: (state: typeof runtime.narra) => T) =>
      useSyncExternalStore(
        (listener) => {
          runtime.narraListeners.add(listener);
          return () => runtime.narraListeners.delete(listener);
        },
        () => selector(runtime.narra),
      ),
  };
});
vi.mock("../../stores/persist", () => ({
  withPersist:
    <T extends object>(_key: string, creator: StateCreator<T>): StateCreator<T> =>
    (set, get, api) => {
      const wrappedSet: typeof set = (partial, replace) => {
        runtime.persistedSets();
        if (replace) set(partial as T, true);
        else set(partial);
      };
      return creator(wrappedSet, get, api);
    },
}));
vi.mock("@/components/chat/animated-narra-face", () => ({
  AnimatedNarraFace: "AnimatedNarraFace",
}));
vi.mock(
  "@/components/chats/character-chat-list",
  () => import("../../components/chats/character-chat-list"),
);
vi.mock("@/components/narra/character-portrait-image", () => ({
  CharacterPortraitImage: "PortraitImage",
}));
vi.mock("@/components/ui/centered-empty-state", () => ({
  CenteredEmptyState: "CenteredEmptyState",
}));
vi.mock("@/components/ui/empty-state-action-button", () => ({
  EmptyStateActionButton: "EmptyStateActionButton",
}));
vi.mock("@/components/ui/initials-avatar", () => ({ InitialsAvatar: "InitialsAvatar" }));
vi.mock("@/components/ui/native-segmented-pager", () => ({ NativeSegmentedPager: "Pager" }));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("@/components/ui/NativeButton", () => ({ NativeButton: "NativeButton" }));
vi.mock("@/components/ui/Icon", () => ({ RotateCcwIcon: "RotateCcwIcon" }));
vi.mock("@/components/ui/swipe-press-guard", () => ({ useSwipePressGuard: () => runtime.guard }));
vi.mock("@/lib/book/book-tab-label", () => import("../book/book-tab-label"));
vi.mock("@/lib/book/cover-text-contrast", () => ({ generatedCoverTextTone: () => "dark" }));
vi.mock("@/lib/book/format-book-cover-title", () => import("../book/format-book-cover-title"));
vi.mock("@/lib/narra/bundled-catalog-characters", () => ({
  getBundledCatalogCharactersByTitle: () => undefined,
}));
vi.mock("@/lib/narra/character-portrait", () => ({
  hasCharacterPortrait: (character: NarraCharacter) => Boolean(character.portraitUri),
}));
vi.mock("@/lib/narra/chat-list-model", () => import("./chat-list-model"));
vi.mock("@/lib/narra/catalog-cover-state", () => import("./catalog-cover-state"));
vi.mock("@/lib/narra/catalog-cover-store", () => import("./catalog-cover-store"));
vi.mock("@/hooks/use-catalog-cover", () => import("../../hooks/use-catalog-cover"));
vi.mock("@/lib/narra/errors", () => ({ reportNarraError: vi.fn() }));
vi.mock("@/lib/narra/media", () => ({ ensureCharacterPortrait: runtime.ensurePortrait }));
vi.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
vi.mock("react-native-gesture-handler", () => ({ GestureDetector: "GestureDetector" }));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("../../components/library/cover-press", () => ({
  useCoverPress: () => ({ pressStyle: {}, gesture: {} }),
}));
vi.mock("../../components/library/use-cover-foreground", () => ({
  useCoverForeground: runtime.foreground,
}));

import { CatalogBookCard } from "../../components/library/CatalogBookCard";
import { ConnectedCatalogBookCard } from "../../components/library/ConnectedCatalogBookCard";
import { BookCoverTypography } from "../../components/library/book-cover-typography";
import { ChatsScreen } from "../../screens/ChatsScreen";
import { useBookDownload } from "../../screens/library/useBookDownload";
import { useNarraStore as persistedNarraStore } from "../../stores/narra-store";
import { catalogCoverStore } from "./catalog-cover-store";
import { emptyNarraBookState } from "./domain";

let renderer: ReactTestRenderer | undefined;
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
const initialNarraState = persistedNarraStore.getState();

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

beforeEach(() => {
  runtime.counters.clear();
  runtime.focused = true;
  runtime.library = { books: [] };
  runtime.narra = { books: {}, setCharacters: vi.fn(), updateCharacter: vi.fn() };
  runtime.navigation.navigate.mockClear();
  runtime.guard.canPress.mockReset().mockReturnValue(true);
  runtime.ensurePortrait.mockClear();
  runtime.persistedSets.mockClear();
  runtime.foreground.mockClear();
});

afterEach(async () => {
  if (renderer) await act(() => renderer?.unmount());
  renderer = undefined;
  persistedNarraStore.setState(initialNarraState, true);
  catalogCoverStore.retainBooks([]);
});

async function render(element: React.ReactElement) {
  await act(() => {
    renderer = create(element);
  });
  if (!renderer) throw new Error("Expected a mounted test renderer");
  return renderer;
}

function hosts(root: ReactTestInstance, name: string) {
  return root.findAll((node) => node.type === name);
}

function count(name: string) {
  return runtime.counters.get(name) ?? 0;
}

function book(id: string): Book {
  return {
    id,
    meta: { title: id, author: "Author" },
    filePath: `${id}.epub`,
    format: "epub",
    progress: 1,
    addedAt: 1,
    updatedAt: 1,
    isVectorized: false,
    vectorizeProgress: 0,
    tags: [],
    syncStatus: "local",
  };
}

function character(id: string): NarraCharacter {
  return {
    id,
    name: id,
    fullName: id,
    role: "Character",
    gender: "male",
    voice: "voice",
    traits: [],
    speechStyle: "",
    speechExamples: [],
    appearancePrompt: "",
    unlockProgress: 0,
    portraitUri: `file:///${id}`,
  };
}

function seedChats() {
  runtime.library.books = [book("a"), book("b"), book("c")];
  runtime.narra.books = Object.fromEntries(
    runtime.library.books.map((item) => [
      item.id,
      {
        ...emptyNarraBookState(item.id),
        characters: [character(`${item.id}1`), character(`${item.id}2`)],
      },
    ]),
  );
}

async function focus(value: boolean) {
  await act(() => {
    runtime.focused = value;
    for (const listener of runtime.focusListeners) listener();
  });
}

describe("Chats render isolation", () => {
  it("isolates equal real-store reanalysis while keeping changed character data current", async () => {
    seedChats();
    runtime.narra.books.a = {
      ...runtime.narra.books.a,
      analyzedAt: 100,
      analysisError: "old analysis failure",
    };
    persistedNarraStore.setState({ books: runtime.narra.books });
    const before = persistedNarraStore.getState();
    // Bridge the existing mocked subscription boundary to the real store;
    // ChatsScreen, its selector, pages and rows remain actual components.
    const unsubscribe = persistedNarraStore.subscribe((next) => {
      runtime.narra = { ...runtime.narra, books: next.books };
      for (const listener of runtime.narraListeners) listener();
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(200);
    try {
      const view = await render(<ChatsScreen />);
      runtime.counters.clear();
      runtime.persistedSets.mockClear();
      const copies = before.books.a.characters.map((item) => ({
        ...item,
        traits: [...item.traits],
        speechExamples: [...item.speechExamples],
      }));
      await act(() => persistedNarraStore.getState().setCharacters("a", copies));
      const reanalyzed = persistedNarraStore.getState();
      expect(reanalyzed.books.a).not.toBe(before.books.a);
      expect(reanalyzed.books.a.characters).toBe(before.books.a.characters);
      expect(reanalyzed.books.b).toBe(before.books.b);
      expect(reanalyzed.books.a.analyzedAt).toBe(200);
      expect(reanalyzed.books.a.analysisError).toBeUndefined();
      expect(runtime.persistedSets).toHaveBeenCalledOnce();
      expect(count("chats.screen")).toBe(0);
      expect(count("chats.page.build")).toBe(0);
      expect(count("chats.row")).toBe(0);

      await act(() =>
        persistedNarraStore
          .getState()
          .setCharacters("a", [
            { ...copies[0], chatPlaceholder: "Current synthetic placeholder" },
            copies[1],
          ]),
      );
      expect(count("chats.screen")).toBe(1);
      expect(count("chats.page.build")).toBe(2);
      expect(count("chats.row")).toBe(2);
      const current = persistedNarraStore.getState().books.a.characters[0];
      const portraits = hosts(view.root, "PortraitImage").filter(
        (node) => node.props.character.id === "a1",
      );
      expect(portraits).toHaveLength(2);
      for (const portrait of portraits) {
        expect(portrait.props.character).toBe(current);
        expect(portrait.props.character.chatPlaceholder).toBe("Current synthetic placeholder");
      }

      runtime.counters.clear();
      const currentCharacters = persistedNarraStore.getState().books.a.characters;
      await act(() =>
        persistedNarraStore.getState().setCharacters("a", [
          { ...currentCharacters[0], portraitUri: "file:///current-portrait" },
          { ...currentCharacters[1], traits: [...currentCharacters[1].traits] },
        ]),
      );
      expect(count("chats.page.build")).toBe(2);
      expect(count("chats.row")).toBe(2);
      expect(persistedNarraStore.getState().books.a.characters[1]).toBe(currentCharacters[1]);
    } finally {
      unsubscribe();
      clock.mockRestore();
    }
  });

  it("does not notify subscribers or invoke persisted set for repeated and obsolete portrait results", () => {
    const a = { ...emptyNarraBookState("a"), characters: [character("a1"), character("a2")] };
    const b = { ...emptyNarraBookState("b"), characters: [character("b1")] };
    persistedNarraStore.setState({ books: { a, b } });
    const before = persistedNarraStore.getState();
    const listener = vi.fn();
    const unsubscribe = persistedNarraStore.subscribe(listener);
    try {
      before.updateCharacter("removed-book", "a1", { portraitUri: "file:///old" });
      before.updateCharacter("a", "removed-character", { portraitUri: "file:///old" });
      before.updateCharacter("a", "a1", { portraitUri: a.characters[0].portraitUri });
      expect(persistedNarraStore.getState()).toBe(before);
      expect(listener).not.toHaveBeenCalled();
      expect(runtime.persistedSets).not.toHaveBeenCalled();

      before.updateCharacter("a", "a1", { portraitUri: "file:///replacement" });
      expect(runtime.persistedSets).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(persistedNarraStore.getState().books.b).toBe(b);
      expect(persistedNarraStore.getState().books.a.characters[1]).toBe(a.characters[1]);
    } finally {
      unsubscribe();
    }
  });

  it("does not rebuild heavy content or rows on focus-only changes and retains the selected page", async () => {
    seedChats();
    const view = await render(<ChatsScreen />);
    const scroll = hosts(view.root, "ScrollView")[0];
    await act(() => hosts(view.root, "Pager")[0].props.onSelect(2));
    runtime.counters.clear();
    for (let cycle = 0; cycle < 5; cycle += 1) {
      await focus(false);
      await focus(true);
    }
    expect(count("chats.screen")).toBe(0);
    expect(count("chats.page.build")).toBe(0);
    expect(count("chats.row")).toBe(0);
    expect(hosts(view.root, "Pager")[0].props.selectedIndex).toBe(2);
    expect(hosts(view.root, "ScrollView")[0]).toBe(scroll);
  });

  it("updates only the affected book page and its All-page row for one completed portrait", async () => {
    seedChats();
    await render(<ChatsScreen />);
    runtime.counters.clear();
    await act(() => {
      const a = runtime.narra.books.a;
      runtime.narra = {
        ...runtime.narra,
        books: {
          ...runtime.narra.books,
          a: {
            ...a,
            characters: [
              { ...a.characters[0], portraitUri: "file:///replacement" },
              a.characters[1],
            ],
          },
        },
      };
      for (const listener of runtime.narraListeners) listener();
    });
    expect(count("chats.page.build")).toBe(2);
    expect(count("chats.row")).toBe(2);
  });

  it("keeps heavy content stable for a parent render and unrelated book-state updates", async () => {
    seedChats();
    const view = await render(<ChatsScreen />);
    runtime.counters.clear();
    await act(() => view.update(<ChatsScreen />));
    await act(() => {
      runtime.narra = {
        ...runtime.narra,
        books: {
          ...runtime.narra.books,
          a: { ...runtime.narra.books.a, memories: { a1: "test" } },
        },
      };
      for (const listener of runtime.narraListeners) listener();
    });
    expect(count("chats.screen")).toBe(0);
    expect(count("chats.page.build")).toBe(0);
    expect(count("chats.row")).toBe(0);
  });
});

describe("Catalog card render and decode", () => {
  function props() {
    return {
      title: "Synthetic title",
      author: "Synthetic author",
      coverUri: "file:///cover-a",
      hasCover: true,
      cardWidth: 170,
      isInLibrary: false,
      onPress: vi.fn(),
      onRetryCover: vi.fn(),
    };
  }

  function catalogFixtures(): CachedBackendCatalogBook[] {
    return ["a", "b"].map((id) => ({
      resolution: "catalog",
      bookEditionId: id,
      catalogKey: id,
      title: id,
      author: "Author",
      genres: [],
      format: "epub",
      contentSha256: "0".repeat(64),
      sourceDownloadPath: `/v2/books/${id}/source/download`,
      generationStatus: "ready",
      ready: true,
      cover: {
        contentHash: "a".repeat(64),
        mimeType: "image/jpeg",
        byteSize: 10,
        downloadPath: `/v2/books/${id}/cover/download`,
      },
    }));
  }

  it("keeps the decoder Image mounted while adding text, gradients and the ready action", async () => {
    const card = props();
    const view = await render(<CatalogBookCard {...card} />);
    const image = hosts(view.root, "Image")[0];
    const source = image.props.source;
    const hasShadow = () =>
      hosts(view.root, "AnimatedView")[0].props.style.some(
        (style: { boxShadow?: string } | undefined) => Boolean(style?.boxShadow),
      );
    expect(hosts(view.root, "LinearGradient")).toHaveLength(0);
    expect(hosts(view.root, "Text")).toHaveLength(0);
    expect(hasShadow()).toBe(false);
    expect(runtime.foreground).toHaveBeenCalledWith(card.coverUri, "dark");
    await act(() => image.props.onLoad());
    expect(hosts(view.root, "Image")[0]).toBe(image);
    expect(image.props.source).toBe(source);
    expect(hosts(view.root, "LinearGradient")).toHaveLength(3);
    expect(hosts(view.root, "Text")).toHaveLength(4);
    expect(hasShadow()).toBe(true);
    const pressable = hosts(view.root, "Pressable")[0];
    expect(pressable.props.disabled).toBe(false);
    await act(() => pressable.props.onPress({ nativeEvent: { identifier: 1 } }));
    expect(card.onPress).toHaveBeenCalledTimes(1);
  });

  it("renders only the subscribed sibling for a cover completion and cleans up subscriptions", async () => {
    const catalogBooks = catalogFixtures();
    const onPress = vi.fn();
    const onRetryCover = vi.fn();
    catalogCoverStore.retainBooks(catalogBooks);
    const view = await render(
      <View>
        {catalogBooks.map((item) => (
          <ConnectedCatalogBookCard
            key={item.catalogKey}
            book={item}
            cardWidth={170}
            isInLibrary={false}
            onPress={onPress}
            onRetryCover={onRetryCover}
          />
        ))}
      </View>,
    );
    expect(catalogCoverStore.getDiagnostics().listeners).toBe(2);
    runtime.counters.clear();
    await act(() => catalogCoverStore.setResult(catalogBooks[0], "file:///a"));
    expect(count("catalog.card")).toBe(1);
    expect(hosts(view.root, "Image")).toHaveLength(1);
    expect(hosts(view.root, "Image")[0].props.source.uri).toBe("file:///a");
    expect(catalogBooks[0].coverUri).toBeUndefined();
    expect(catalogCoverStore.getBook(catalogBooks[1])).toBe(catalogBooks[1]);
    runtime.counters.clear();
    await act(() => catalogCoverStore.setResult(catalogBooks[0], "file:///a"));
    expect(count("catalog.card")).toBe(0);
    expect(count("catalog.perspective")).toBe(0);
    await act(() => hosts(view.root, "Image")[0].props.onLoad());
    await act(() =>
      hosts(view.root, "Pressable")
        .find((item) => item.props.accessibilityLabel === "a")
        ?.props.onPress(),
    );
    expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ coverUri: "file:///a" }));
    await act(() => view.unmount());
    renderer = undefined;
    expect(catalogCoverStore.getDiagnostics().listeners).toBe(0);
    expect(catalogCoverStore.getDiagnostics().subscribedIdentities).toBe(0);
  });

  it("isolates cards from parent updates when the real download hook receives a stable callback", async () => {
    const catalogBooks = catalogFixtures();
    catalogCoverStore.retainBooks(catalogBooks);
    const localBook = book("local");
    const loadBooks = vi.fn(async () => {});
    const onSuccess = vi.fn();
    const onRetryCover = vi.fn();
    function DownloadBoundary({
      onSuccess,
    }: { onSuccess: (bookId: string) => void; iteration: number }) {
      const { downloadBook } = useBookDownload({ loadBooks, onSuccess });
      const handleOpen = useCallback(() => downloadBook(localBook), [downloadBook]);
      const handleCatalogOpen = useCallback(() => void handleOpen(), [handleOpen]);
      return (
        <View>
          {catalogBooks.map((item) => (
            <ConnectedCatalogBookCard
              key={item.catalogKey}
              book={item}
              cardWidth={170}
              isInLibrary={false}
              onPress={handleCatalogOpen}
              onRetryCover={onRetryCover}
            />
          ))}
        </View>
      );
    }
    const view = await render(<DownloadBoundary onSuccess={onSuccess} iteration={0} />);
    runtime.counters.clear();
    for (let iteration = 1; iteration <= 5; iteration++) {
      await act(() =>
        view.update(<DownloadBoundary onSuccess={onSuccess} iteration={iteration} />),
      );
    }
    expect(count("catalog.card")).toBe(0);
    expect(count("catalog.perspective")).toBe(0);

    // Control: the previous inline callback invalidates the actual hook and
    // action chain even though every book, cover and visual prop is unchanged.
    for (let iteration = 6; iteration <= 10; iteration++) {
      await act(() => view.update(<DownloadBoundary onSuccess={() => {}} iteration={iteration} />));
    }
    expect(count("catalog.card")).toBe(catalogBooks.length * 5);
    expect(count("catalog.perspective")).toBe(catalogBooks.length * 5);
    expect(loadBooks).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("does not rerender an unchanged card when the parent rerenders", async () => {
    const card = props();
    const view = await render(<CatalogBookCard {...card} />);
    runtime.counters.clear();
    await act(() => view.update(<CatalogBookCard {...card} />));
    expect(count("catalog.card")).toBe(0);
    expect(count("catalog.perspective")).toBe(0);
  });

  it("ignores stale decoder events after the requested image changes", async () => {
    const card = props();
    const view = await render(<CatalogBookCard {...card} />);
    const oldLoad = hosts(view.root, "Image")[0].props.onLoad;
    const oldError = hosts(view.root, "Image")[0].props.onError;
    await act(() => view.update(<CatalogBookCard {...card} coverUri="file:///cover-b" />));
    await act(() => oldLoad());
    await act(() => oldError());
    expect(hosts(view.root, "Text")).toHaveLength(0);
    expect(hosts(view.root, "RotateCcwIcon")).toHaveLength(0);
    await act(() => hosts(view.root, "Image")[0].props.onLoad());
    expect(view.root.findByType(BookCoverTypography).props.coverUri).toBe("file:///cover-b");
  });

  it("keeps retry and ready presses single-action and honours rejected swipe presses", async () => {
    const card = props();
    const view = await render(<CatalogBookCard {...card} />);
    await act(() => hosts(view.root, "Image")[0].props.onError());
    const retry = hosts(view.root, "Pressable").find(
      (node) => node.props.accessibilityLabel === `Повторить: ${card.title}`,
    );
    if (!retry) throw new Error("Expected accessible cover retry action");
    expect(retry.props.accessibilityRole).toBe("button");
    expect(hosts(retry, "RotateCcwIcon")[0].props).toMatchObject({
      size: 32,
      color: runtime.theme.colors.primary30,
    });
    expect(retry.props.style({ pressed: true })).toEqual([
      { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
      { transform: [{ scale: 0.96 }] },
    ]);
    expect(hosts(view.root, "NativeButton")).toHaveLength(0);
    const event = { nativeEvent: { timestamp: 123 } };
    runtime.guard.canPress.mockReturnValue(false);
    await act(() => retry.props.onPress(event));
    expect(card.onRetryCover).not.toHaveBeenCalled();
    expect(runtime.guard.canPress).toHaveBeenLastCalledWith(event);
    runtime.guard.canPress.mockReturnValue(true);
    await act(() => retry.props.onPress(event));
    expect(card.onRetryCover).toHaveBeenCalledTimes(1);
    expect(card.onPress).not.toHaveBeenCalled();
    expect(hosts(view.root, "RotateCcwIcon")).toHaveLength(0);
    await act(() => hosts(view.root, "Image")[0].props.onLoad());
    runtime.guard.canPress.mockReturnValue(false);
    await act(() => hosts(view.root, "Pressable")[0].props.onPress());
    expect(card.onPress).not.toHaveBeenCalled();
    runtime.guard.canPress.mockReturnValue(true);
    await act(() => hosts(view.root, "Pressable")[0].props.onPress());
    expect(card.onPress).toHaveBeenCalledTimes(1);
  });
});

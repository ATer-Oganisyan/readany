import type { Book } from "@readany/core/types";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CachedBackendCatalogBook } from "./backend-catalog-cache";

const state = vi.hoisted(() => ({
  books: [] as Book[],
  loadBooks: vi.fn(),
  open: vi.fn(),
  download: vi.fn(),
  focused: true,
  replace: vi.fn(),
  error: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Image: "Image",
  ScrollView: "ScrollView",
  View: "View",
  StyleSheet: { create: (v: unknown) => v, absoluteFill: {} },
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
    i18n: { resolvedLanguage: "ru" },
  }),
}));
vi.mock("@/styles/theme", () => ({
  bodyTypography: {},
  title24Typography: {},
  titleFontFamily: "Interface",
  spacing: { sm: 8, lg: 16, xl: 24 },
  useTheme: () => ({ colors: {}, isDark: false }),
}));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("@/components/ui/NativeButton", () => ({ NativeButton: "NativeButton" }));
vi.mock("@/components/library/book-cover-typography", () => ({ BookCoverTypography: "CoverText" }));
vi.mock("@/components/library/perspective-book", () => ({ BookSurface: "Cover" }));
vi.mock("@/components/library/use-resolved-asset-uris", () => ({
  useResolvedAssetUris: () => new Map(),
}));
vi.mock("@/components/narra/NativeCharacterDetailsCells", () => ({
  NativeCharacterDetailsCells: "Details",
}));
vi.mock("@/screens/notes/useResolvedCovers", () => ({ useResolvedCovers: () => new Map() }));
vi.mock("@/lib/catalog/bundled-books", () => ({ findBundledCatalogBookByTitle: () => undefined }));
vi.mock("@/hooks/use-cover-sheet-colors", () => ({ useCoverSheetColors: () => undefined }));
vi.mock("@/hooks/use-backend-catalog", () => ({
  useBackendCatalog: () => ({ catalog: { genres: [] } }),
}));
vi.mock("@/lib/narra/catalog-cover-store", () => ({ getCatalogBookWithCover: (v: unknown) => v }));
vi.mock("@/lib/library/open-mobile-book", () => ({ openMobileBook: state.open }));
vi.mock("@/screens/library/useBookDownload", () => ({
  useBookDownload: () => ({ downloadBook: state.download }),
}));
vi.mock("@/lib/notifications", () => ({ toast: { error: state.error } }));
vi.mock("@/stores/library-store", () => ({
  useLibraryStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state,
  }),
}));

import { BookDetailsScreen } from "@/screens/book-details-screen";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

const catalog: CachedBackendCatalogBook = {
  resolution: "catalog",
  bookEditionId: "edition",
  catalogKey: "key",
  title: "Книга",
  author: "Автор",
  genres: [],
  format: "epub",
  contentSha256: "a".repeat(64),
  generationStatus: "published",
  ready: true,
  sourceDownloadPath: "/book",
};
const local = (changes: Partial<Book> = {}): Book => ({
  id: "local",
  filePath: "books/local.epub",
  format: "epub",
  sourceKind: "catalog",
  bookEditionId: "edition",
  meta: {
    title: "Книга",
    author: "Автор",
    description: "<p>О любви &amp; дружбе.</p><p>Без спойлеров.</p>",
  },
  addedAt: 1,
  updatedAt: 1,
  progress: 0.25,
  currentCfi: "saved-position",
  isVectorized: false,
  vectorizeProgress: 0,
  tags: [],
  syncStatus: "local",
  ...changes,
});
let renderer: ReactTestRenderer;
async function render(params: RootStackParamList["BookDetails"]) {
  const props = {
    route: { params },
    navigation: { isFocused: () => state.focused, replace: state.replace, setOptions: vi.fn() },
  } as unknown as NativeStackScreenProps<RootStackParamList, "BookDetails">;
  await act(() => {
    renderer = create(<BookDetailsScreen {...props} />);
  });
  return renderer.root.findByProps({ testID: "book-details-read" });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.books = [];
  state.focused = true;
  state.open.mockResolvedValue(true);
  state.download.mockResolvedValue(true);
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
});

it("shows cached metadata without opening or downloading a catalog book", async () => {
  const button = await render({ catalogBook: catalog });
  expect(button.props.label).toBe("Читать");
  expect(state.open).not.toHaveBeenCalled();
  expect(state.download).not.toHaveBeenCalled();
  await act(() => button.props.onPress());
  expect(state.replace).toHaveBeenCalledExactlyOnceWith("Reader", {
    bookId: "",
    catalogBook: catalog,
  });
});
it("renders plain annotation and keeps the saved reading position", async () => {
  state.books = [local()];
  const button = await render({ bookId: "local" });
  expect(button.props.label).toBe("Читать");
  const details = renderer.root.findByType("Details" as never);
  expect(details.props.items[0].value).toBe("О любви & дружбе.\n\nБез спойлеров.");
  await act(() => button.props.onPress());
  expect(state.open).toHaveBeenCalledWith(
    expect.objectContaining({ bookId: "local", replace: true }),
  );
  expect(state.books[0].currentCfi).toBe("saved-position");
  expect(state.books[0].progress).toBe(0.25);
});
it("uses a copy imported after the sheet opened instead of downloading it again", async () => {
  const button = await render({ catalogBook: catalog });
  state.books = [local()];
  await act(() => button.props.onPress());
  expect(state.open).toHaveBeenCalledWith(expect.objectContaining({ bookId: "local" }));
  expect(state.replace).not.toHaveBeenCalled();
  expect(state.download).not.toHaveBeenCalled();
});
it("downloads a remote copy only on Read and ignores repeated taps", async () => {
  state.books = [local({ syncStatus: "remote" })];
  let complete!: (ok: boolean) => void;
  state.download.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        complete = resolve;
      }),
  );
  const button = await render({ bookId: "local" });
  expect(state.download).not.toHaveBeenCalled();
  await act(() => {
    button.props.onPress();
    button.props.onPress();
  });
  expect(state.download).toHaveBeenCalledTimes(1);
  expect(state.open).not.toHaveBeenCalled();
  await act(() => complete(true));
  expect(state.open).toHaveBeenCalledTimes(1);
});
it("does not open a reader after download if the sheet was dismissed", async () => {
  state.books = [local({ syncStatus: "remote" })];
  state.download.mockImplementation(async () => {
    state.focused = false;
    return true;
  });
  const button = await render({ bookId: "local" });
  await act(() => button.props.onPress());
  expect(state.open).not.toHaveBeenCalled();
  expect(state.replace).not.toHaveBeenCalled();
});
it("keeps the sheet usable after a failed remote download", async () => {
  state.books = [local({ syncStatus: "remote" })];
  state.download.mockResolvedValueOnce(false);
  const button = await render({ bookId: "local" });
  await act(() => button.props.onPress());
  expect(state.open).not.toHaveBeenCalled();
  expect(button.props.disabled).toBe(false);
  await act(() => button.props.onPress());
  expect(state.open).toHaveBeenCalledTimes(1);
});

it("uses the tapped cover on the first render before local URI resolution", async () => {
  state.books = [local()];
  await render({
    bookId: "local",
    coverUri: "file:///already-visible.jpg",
    sourceId: "card:local",
  });
  const cover = renderer.root.findByType("Cover" as never);
  const image = cover.props.cover.props.children[0];
  expect(image.props.source).toEqual({ uri: "file:///already-visible.jpg" });
});

import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const ports = vi.hoisted(() => ({ get: vi.fn(), remove: vi.fn(), committed: [] }));
vi.mock("@readany/core/db/database", () => ({ getBookmarks: ports.get }));
vi.mock("@/stores", () => ({
  useAnnotationStore: (selector: (s: unknown) => unknown) =>
    selector({ removeBookmark: ports.remove, bookmarks: ports.committed }),
}));
vi.mock("@/styles/theme", () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("@/components/ui/Icon", () => ({ Trash2Icon: "Icon" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  ActivityIndicator: "ActivityIndicator",
  FlatList: ({
    data,
    renderItem,
    ListEmptyComponent,
  }: {
    data: unknown[];
    renderItem: (arg: { item: unknown }) => unknown;
    ListEmptyComponent: unknown;
  }) => (data.length ? data.map((item) => renderItem({ item })) : ListEmptyComponent),
}));
import { ReaderBookmarksPanel } from "../../screens/reader/reader-bookmarks-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const row = { id: "saved", bookId: "a", cfi: "exact-cfi", label: "Visible text", createdAt: 1 };
let tree: ReactTestRenderer;
const select = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  ports.committed = [];
  ports.get.mockResolvedValue([row]);
  ports.remove.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});
async function mount(bookId = "a") {
  await act(async () => {
    tree = create(<ReaderBookmarksPanel bookId={bookId} onSelectCfi={select} />);
  });
}
it("explains the actual mobile menu path when there are no bookmarks", async () => {
  ports.get.mockResolvedValue([]);
  await mount();
  expect(tree.root.findAllByProps({ children: "bookmarks.mobileEmptyHint" })).toHaveLength(1);
  expect(tree.root.findAllByProps({ children: "bookmarks.emptyHint" })).toHaveLength(0);
});
it("opens the exact persisted bookmark and excludes other books", async () => {
  ports.get.mockResolvedValue([row, { ...row, id: "foreign", bookId: "b" }]);
  await mount();
  expect(tree.root.findAllByProps({ testID: "bookmark-open-foreign" })).toHaveLength(0);
  await act(async () => tree.root.findByProps({ testID: "bookmark-open-saved" }).props.onPress());
  expect(select).toHaveBeenCalledExactlyOnceWith("exact-cfi");
});
it("keeps a row during delete and removes it only after database acknowledgement", async () => {
  let finish!: () => void;
  ports.remove.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  await mount();
  await act(async () => tree.root.findByProps({ testID: "bookmark-delete-saved" }).props.onPress());
  expect(tree.root.findByProps({ testID: "bookmark-delete-saved" }).props.disabled).toBe(true);
  expect(tree.root.findAllByProps({ testID: "bookmark-open-saved" })).toHaveLength(1);
  await act(async () => finish());
  expect(tree.root.findAllByProps({ testID: "bookmark-open-saved" })).toHaveLength(0);
});
it("keeps the row and offers another delete attempt after failure", async () => {
  ports.remove.mockRejectedValueOnce(new Error("locked"));
  await mount();
  await act(async () => tree.root.findByProps({ testID: "bookmark-delete-saved" }).props.onPress());
  expect(tree.root.findByProps({ accessibilityRole: "alert" }).props.children).toBe(
    "bookmarks.saveFailed",
  );
  await act(async () => tree.root.findByProps({ testID: "bookmark-delete-saved" }).props.onPress());
  expect(ports.remove).toHaveBeenCalledTimes(2);
});
it("keeps the current delete busy when another committed write refreshes the list", async () => {
  let finish!: () => void;
  ports.remove.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  await mount();
  await act(async () => tree.root.findByProps({ testID: "bookmark-delete-saved" }).props.onPress());
  // A different bookmark is committed while this deletion is awaiting the DB.
  ports.committed = [];
  await act(async () => tree.update(<ReaderBookmarksPanel bookId="a" onSelectCfi={select} />));
  const button = tree.root.findByProps({ testID: "bookmark-delete-saved" });
  expect(button.props.disabled).toBe(true);
  expect(button.props.accessibilityState.busy).toBe(true);
  await act(async () => finish());
  expect(tree.root.findAllByProps({ testID: "bookmark-open-saved" })).toHaveLength(0);
});
it("shows a load error instead of an empty library and can retry", async () => {
  ports.get.mockRejectedValueOnce(new Error("locked"));
  await mount();
  expect(tree.root.findByProps({ accessibilityRole: "alert" }).props.children).toBe(
    "bookmarks.loadFailed",
  );
  await act(async () => tree.root.findByProps({ accessibilityRole: "button" }).props.onPress());
  expect(tree.root.findAllByProps({ testID: "bookmark-open-saved" })).toHaveLength(1);
});
it("does not let a slow previous-book read replace the current list", async () => {
  let finish!: (rows: (typeof row)[]) => void;
  ports.get.mockReturnValueOnce(
    new Promise<(typeof row)[]>((resolve) => {
      finish = resolve;
    }),
  );
  await mount();
  ports.get.mockResolvedValueOnce([{ ...row, id: "b-row", bookId: "b" }]);
  await act(async () => tree.update(<ReaderBookmarksPanel bookId="b" onSelectCfi={select} />));
  await act(async () => finish([row]));
  expect(tree.root.findAllByProps({ testID: "bookmark-open-saved" })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: "bookmark-open-b-row" })).toHaveLength(1);
});
it("a previous-book deletion cannot leave the new list locked or clear its pending action", async () => {
  let finishA!: () => void;
  let finishB!: () => void;
  ports.remove
    .mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishA = resolve;
      }),
    )
    .mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishB = resolve;
      }),
    );
  await mount();
  await act(async () => tree.root.findByProps({ testID: "bookmark-delete-saved" }).props.onPress());
  ports.get.mockResolvedValueOnce([{ ...row, id: "b-row", bookId: "b" }]);
  await act(async () => tree.update(<ReaderBookmarksPanel bookId="b" onSelectCfi={select} />));
  expect(tree.root.findByProps({ testID: "bookmark-delete-b-row" }).props.disabled).toBe(false);
  await act(async () => tree.root.findByProps({ testID: "bookmark-delete-b-row" }).props.onPress());
  await act(async () => finishA());
  expect(tree.root.findByProps({ testID: "bookmark-delete-b-row" }).props.disabled).toBe(true);
  await act(async () => finishB());
  expect(tree.root.findAllByProps({ testID: "bookmark-open-b-row" })).toHaveLength(0);
});

import type { HighlightWithBook } from "@readany/core/db/database";
import type { ComponentProps, EffectCallback } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  platform: "ios",
  focused: true,
  listeners: new Set<() => void>(),
  navigate: vi.fn(),
  setOptions: vi.fn(),
  goBack: vi.fn(),
  load: vi.fn(async () => {}),
  remove: vi.fn(),
  update: vi.fn(),
  toastError: vi.fn(),
  highlights: [] as HighlightWithBook[],
  t: (key: string) => key,
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return state.platform;
    },
  },
  StyleSheet: { create: <T,>(styles: T) => styles },
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: vi.fn() },
  Image: "Image",
  ScrollView: "ScrollView",
  TouchableOpacity: "TouchableOpacity",
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
vi.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 64 }));
vi.mock("@react-navigation/native", async () => {
  const { useEffect, useSyncExternalStore } = await import("react");
  return {
    useRoute: () => ({ params: { bookId: "book-a" } }),
    useNavigation: () => ({
      navigate: state.navigate,
      setOptions: state.setOptions,
      goBack: state.goBack,
    }),
    useFocusEffect: (callback: EffectCallback) => {
      const focused = useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => state.listeners.delete(listener);
        },
        () => state.focused,
      );
      useEffect(() => (focused ? callback() : undefined), [focused, callback]);
    },
  };
});
vi.mock("@/components/notes/NativeNotesList", () => ({ NativeNotesList: "NativeNotesList" }));
vi.mock("@/components/ui/Icon", () => ({
  BookOpenIcon: "Icon",
  ChevronLeftIcon: "Icon",
  HighlighterIcon: "Icon",
  NotebookPenIcon: "Icon",
}));
vi.mock("@/components/ui/NativeContextMenuButton", () => ({
  NativeContextMenuButton: "ContextMenu",
}));
vi.mock("@/components/ui/ScrollViewMarker", () => ({ ScrollViewMarker: "ScrollViewMarker" }));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("@/components/ui/NativeButton", () => ({ NativeButton: "NativeButton" }));
vi.mock("@/components/ui/MishanaerIcon", () => ({
  getStrokeIconImageSource: (name: string) => ({ uri: name }),
}));
vi.mock("@/components/ui/centered-empty-state", () => ({ CenteredEmptyState: "EmptyState" }));
vi.mock("@/components/ui/empty-state-action-button", () => ({ EmptyStateActionButton: "AddNote" }));
vi.mock("@/screens/notes/HighlightCard", () => ({ HighlightCard: "HighlightCard" }));
vi.mock("@/screens/notes/NoteCard", () => ({ NoteCard: "NoteCard" }));
vi.mock("@/screens/notes/notes-styles", () => ({ makeStyles: () => ({}) }));
vi.mock("@/screens/notes/useResolvedCovers", () => ({ useResolvedCovers: () => new Map() }));
vi.mock("@/lib/library/open-mobile-book", () => ({ openMobileBook: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ toast: { success: vi.fn(), error: state.toastError } }));
vi.mock("@/styles/theme", () => ({ useColors: () => ({ background: "#fff", primary: "#000" }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: state.t, i18n: { resolvedLanguage: "en" } }),
}));
vi.mock("@readany/core/export", () => ({ AnnotationExporter: class {} }));
vi.mock("@readany/core/reader", () => ({ sortAnnotationsByPosition: (items: unknown[]) => items }));
vi.mock("@readany/core/utils/event-bus", () => ({ eventBus: { on: () => () => {} } }));
vi.mock("@/stores", () => ({
  useAnnotationStore: () => ({
    highlightsWithBooks: state.highlights,
    loadAllHighlightsWithBooks: state.load,
    removeHighlight: state.remove,
    updateHighlight: state.update,
  }),
  useLibraryStore: (select: (store: { books: unknown[] }) => unknown) => select({ books: [] }),
}));

import { FullScreenNotesScreen } from "@/screens/FullScreenNotesScreen";
import { NotesView } from "@/screens/NotesView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
const bookA = "book-a";
const bookB = "book-b";
function note(bookId: string, id = `note-${bookId}`): HighlightWithBook {
  return {
    id,
    bookId,
    bookTitle: `Title ${bookId}`,
    bookAuthor: "Author",
    bookCoverUrl: undefined,
    note: `Note ${bookId}`,
    text: "",
    cfi: "",
    color: "yellow",
    chapterTitle: "Заметка к книге",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.platform = "ios";
  state.focused = true;
  state.highlights = [];
  state.update.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
});
async function mount(props: ComponentProps<typeof NotesView> = {}) {
  await act(async () => {
    tree = create(<NotesView {...props} />);
  });
}
async function focus(focused: boolean) {
  await act(async () => {
    state.focused = focused;
    for (const listener of state.listeners) listener();
  });
}
function nodes(type: string) {
  if (!tree) throw new Error("NotesView is not mounted");
  return tree.root.findAll((node) => String(node.type) === type);
}
function add() {
  act(() => nodes("AddNote")[0].props.onPress());
}

describe("mounted NotesView book-scoped creation and return", () => {
  it.each(["ios", "android"])(
    "keeps the book tabs below the native header on %s",
    async (platform) => {
      state.platform = platform;
      state.highlights = [note(bookA)];
      await mount({ initialBookId: bookA, hideDetailHeader: true });
      const label = nodes("Text").find(
        (node) =>
          Array.isArray(node.props.children) && node.props.children[0] === "notebook.notesSection",
      );
      const header = label?.parent?.parent?.parent?.parent;
      expect(String(header?.type)).toBe("View");
      const styles = Object.assign({}, ...[header?.props.style].flat());
      expect(styles.paddingTop ?? 0).toBe(platform === "ios" ? 64 : 0);
    },
  );

  it("localizes the legacy book-note marker without modifying saved chapter titles", async () => {
    state.highlights = [note(bookA), { ...note(bookA, "chapter-note"), chapterTitle: "Chapter 2" }];
    await mount({ initialBookId: bookA, hideDetailHeader: true });
    const labels = nodes("Text").map((node) => node.props.children);
    expect(labels).toContain("notes.bookNote");
    expect(labels).toContain("Chapter 2");
    expect(labels).not.toContain("Заметка к книге");
    expect(state.highlights[0].chapterTitle).toBe("Заметка к книге");
  });

  it.each(["ios", "android"])(
    "keeps header Add reachable for another note in a nonempty scoped book on %s",
    async (platform) => {
      state.platform = platform;
      state.highlights = [note(bookA), note(bookB)];
      await act(async () => {
        tree = create(<FullScreenNotesScreen />);
      });
      expect(nodes("NoteCard").map((node) => node.props.highlight.bookId)).toEqual([bookA]);
      const options = state.setOptions.mock.lastCall?.[0];
      if (platform === "ios") {
        const action = options
          .unstable_headerRightItems()
          .find(
            (item: { accessibilityLabel: string }) => item.accessibilityLabel === "notes.addNote",
          );
        act(() => action.onPress());
      } else {
        expect(options.headerLeft).toBeUndefined();
        act(() => options.headerRight().props.onPress());
      }
      expect(state.navigate).toHaveBeenCalledWith("ManualNote", { bookId: bookA });
      expect(state.goBack).not.toHaveBeenCalled();
    },
  );
  it("passes the current Reader book to the empty-list Add note action", async () => {
    await mount({ initialBookId: bookA, hideDetailHeader: true });
    add();
    expect(state.navigate).toHaveBeenCalledWith("ManualNote", { bookId: bookA });
  });
  it("does not show another book's notes instead of an empty current notebook", async () => {
    state.highlights = [note(bookB)];
    await mount({ initialBookId: bookA });
    expect(nodes("NativeNotesList")).toHaveLength(0);
    expect(nodes("AddNote")).toHaveLength(1);
    add();
    expect(state.navigate).toHaveBeenCalledWith("ManualNote", { bookId: bookA });
  });
  it("keeps the same book detail after editor blur and return", async () => {
    state.highlights = [note(bookA), note(bookB)];
    await mount({ initialBookId: bookA });
    expect(nodes("NoteCard").map((n) => n.props.highlight.bookId)).toEqual([bookA]);
    await focus(false);
    await focus(true);
    expect(nodes("NativeNotesList")).toHaveLength(0);
    expect(nodes("NoteCard").map((n) => n.props.highlight.bookId)).toEqual([bookA]);
    expect(state.load).toHaveBeenCalledTimes(2);
  });
  it("shows a newly saved note in its book when returning from creation", async () => {
    await mount({ initialBookId: bookA });
    add();
    await focus(false);
    state.highlights = [note(bookA), note(bookB)];
    await focus(true);
    expect(nodes("NoteCard").map((n) => n.props.highlight.bookId)).toEqual([bookA]);
  });
  it("keeps global empty notes creation standalone", async () => {
    await mount();
    add();
    expect(state.navigate).toHaveBeenCalledWith("ManualNote");
    await focus(false);
    await focus(true);
    add();
    expect(state.navigate).toHaveBeenLastCalledWith("ManualNote");
  });
  it("preserves global existing-note edit routing by noteId", async () => {
    state.highlights = [note(bookA), note(bookB)];
    await mount();
    act(() => nodes("NativeNotesList")[0].props.onPress(`note-${bookB}`));
    expect(state.navigate).toHaveBeenCalledWith({
      name: "ManualNote",
      params: { noteId: `note-${bookB}` },
    });
    expect(state.update).not.toHaveBeenCalled();
  });
  it("edits an existing scoped note without changing its book or CFI", async () => {
    state.highlights = [note(bookA)];
    await mount({ initialBookId: bookA });
    act(() => nodes("NoteCard")[0].props.onStartEdit());
    act(() => nodes("NoteCard")[0].props.setEditNote("Updated body"));
    await act(async () => nodes("NoteCard")[0].props.onSaveNote());
    expect(state.update).toHaveBeenCalledWith(`note-${bookA}`, { note: "Updated body" });
  });

  it("retains the inline draft when a deferred save fails and allows retry", async () => {
    state.highlights = [note(bookA)];
    let rejectWrite!: (error: Error) => void;
    const write = new Promise<void>((_resolve, reject) => {
      rejectWrite = reject;
    });
    void write.catch(() => {}); // The pre-fix callback ignored this acknowledgement.
    state.update.mockReturnValueOnce(write);
    await mount({ initialBookId: bookA });
    act(() => nodes("NoteCard")[0].props.onStartEdit());
    act(() => nodes("NoteCard")[0].props.setEditNote("Keep my draft"));
    act(() => {
      void nodes("NoteCard")[0].props.onSaveNote();
    });
    const editingDuringSave = nodes("NoteCard")[0].props.isEditing;
    await act(async () => rejectWrite(new Error("SQLITE_FULL")));
    expect(editingDuringSave).toBe(true);
    expect(nodes("NoteCard")[0].props).toMatchObject({
      isEditing: true,
      editNote: "Keep my draft",
      isSaving: false,
    });
    expect(state.toastError).toHaveBeenCalledWith("notes.saveFailed", expect.any(Object));
    await act(async () => nodes("NoteCard")[0].props.onSaveNote());
    expect(state.update).toHaveBeenLastCalledWith(`note-${bookA}`, { note: "Keep my draft" });
    expect(nodes("NoteCard")[0].props.isEditing).toBe(false);
  });

  it("does not close a newer inline draft when the previous submitted text finishes saving", async () => {
    state.highlights = [note(bookA)];
    let finish!: () => void;
    state.update.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    await mount({ initialBookId: bookA });
    act(() => nodes("NoteCard")[0].props.onStartEdit());
    act(() => nodes("NoteCard")[0].props.setEditNote("Submitted text"));
    act(() => {
      void nodes("NoteCard")[0].props.onSaveNote();
    });
    act(() => nodes("NoteCard")[0].props.setEditNote("Newer unsaved text"));
    await act(async () => finish());
    expect(nodes("NoteCard")[0].props).toMatchObject({
      isEditing: true,
      editNote: "Newer unsaved text",
    });
  });
});

import type { HighlightWithBook } from "@readany/core/db/database";
import type { ComponentProps } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  goBack: vi.fn(),
  setOptions: vi.fn(),
  toastError: vi.fn(),
  alert: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  rows: [] as HighlightWithBook[],
}));
vi.mock("@readany/core/db/database", () => ({
  insertHighlight: state.insert,
  updateHighlight: state.update,
  getAllHighlightsWithBooks: async () => state.rows,
  getHighlightStats: async () => null,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Alert: { alert: state.alert },
  StyleSheet: { create: <T,>(styles: T) => styles },
  View: "View",
  TouchableOpacity: "TouchableOpacity",
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
vi.mock("@/components/notes/NativeNoteEditor", () => ({ NativeNoteEditor: "NativeNoteEditor" }));
vi.mock("@/components/ui/Icon", () => ({ ChevronDownIcon: "ChevronDown" }));
vi.mock("@/components/ui/NativeButton", () => ({ NativeButton: "NativeButton" }));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("@/components/ui/MishanaerIcon", () => ({
  getStrokeIconImageSource: (name: string) => ({ uri: name }),
}));
vi.mock("@/lib/notifications", () => ({ toast: { error: state.toastError } }));
vi.mock("@readany/core/utils", () => ({ generateId: () => "new-note" }));
vi.mock("@/styles/theme", () => ({
  headingFontFamily: "system",
  spacing: { xs: 4 },
  useColors: () => ({ background: "white", foreground: "black", primary: "orange" }),
}));
vi.mock("@/stores", async () => ({
  useAnnotationStore: (await import("@readany/core/stores/annotation-store")).useAnnotationStore,
  useLibraryStore: (selector: (value: unknown) => unknown) =>
    selector({ books: [{ id: "book-a", meta: { title: "Book A" } }] }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ManualNoteScreen } from "@/screens/ManualNoteScreen";
import { useAnnotationStore } from "@readany/core/stores/annotation-store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const original: HighlightWithBook = {
  id: "saved-note",
  bookId: "book-a",
  bookTitle: "Book A",
  bookAuthor: "Author",
  note: "Saved body",
  text: "",
  cfi: "",
  chapterTitle: "Заметка к книге",
  color: "yellow",
  createdAt: 100,
  updatedAt: 100,
};
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.rows = [];
  state.insert.mockResolvedValue(undefined);
  state.update.mockResolvedValue(undefined);
  useAnnotationStore.setState({ highlights: [], highlightsWithBooks: [], stats: null });
});
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
  vi.restoreAllMocks();
});
function mount(noteId?: string) {
  const navigation = {
    goBack: state.goBack,
    setOptions: state.setOptions,
  } as unknown as ComponentProps<typeof ManualNoteScreen>["navigation"];
  act(() => {
    tree = create(
      <ManualNoteScreen
        navigation={navigation}
        route={{ key: "editor", name: "ManualNote", params: { bookId: "book-a", noteId } }}
      />,
    );
  });
}
function edit(value: string) {
  act(() =>
    tree?.root.find((node) => String(node.type) === "NativeNoteEditor").props.onChange(value),
  );
}
function save() {
  return act(async () =>
    state.setOptions.mock.lastCall?.[0].unstable_headerRightItems()[1].onPress(),
  );
}
function cancelDisabled() {
  return state.setOptions.mock.lastCall?.[0].unstable_headerLeftItems()[0].disabled;
}

describe("ManualNote uses actual annotation-store write acknowledgements", () => {
  it("does not handle a stale Cancel callback once Save has synchronously started", async () => {
    let finish!: () => void;
    state.insert.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    edit("Pending note");
    const options = state.setOptions.mock.lastCall?.[0];
    await act(async () => {
      options.unstable_headerRightItems()[1].onPress();
      options.unstable_headerLeftItems()[0].onPress();
    });
    const alertsWhileSaving = state.alert.mock.calls.length;
    await act(async () => finish());
    expect(alertsWhileSaving).toBe(0);
  });

  it.each(["text", "book"])(
    "preserves a queued %s event before React renders when the write resolves",
    async (kind) => {
      let finish!: () => void;
      state.insert.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      mount();
      edit("Submitted body");
      await save();
      await act(async () => {
        if (kind === "text")
          tree?.root
            .find((node) => String(node.type) === "NativeNoteEditor")
            .props.onChange("Queued newer words");
        else
          state.setOptions.mock.lastCall?.[0]
            .unstable_headerRightItems()[0]
            .menu.items[0].onPress();
        finish();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(state.goBack).not.toHaveBeenCalled();
      await save();
      expect(state.update).toHaveBeenLastCalledWith(
        "new-note",
        expect.objectContaining(kind === "text" ? { note: "Queued newer words" } : { bookId: "" }),
      );
      expect(state.insert).toHaveBeenCalledOnce();
    },
  );

  it.each([false, true])(
    "preserves text typed during %s=new save and updates the same row next time",
    async (isNew) => {
      if (!isNew)
        useAnnotationStore.setState({ highlights: [original], highlightsWithBooks: [original] });
      let finish!: () => void;
      const write = new Promise<void>((resolve) => {
        finish = resolve;
      });
      (isNew ? state.insert : state.update).mockReturnValueOnce(write);
      mount(isNew ? undefined : original.id);
      edit("Submitted body");
      await save();
      edit("Newer unsaved words");
      state.rows = [{ ...original, id: isNew ? "new-note" : original.id, note: "Submitted body" }];
      await act(async () => finish());
      expect(state.goBack).not.toHaveBeenCalled();
      expect(cancelDisabled()).toBe(false);
      await save();
      expect(state.update).toHaveBeenLastCalledWith(
        isNew ? "new-note" : original.id,
        expect.objectContaining({ note: "Newer unsaved words" }),
      );
      expect(state.insert).toHaveBeenCalledTimes(isNew ? 1 : 0);
      expect(state.goBack).toHaveBeenCalledOnce();
    },
  );

  it("preserves a book selection changed during INSERT and reuses the created note id", async () => {
    let finish!: () => void;
    state.insert.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    edit("A note to move");
    await save();
    const bookMenu = state.setOptions.mock.lastCall?.[0].unstable_headerRightItems()[0].menu;
    act(() => bookMenu.items[0].onPress()); // The existing No book option.
    await act(async () => finish());
    expect(state.goBack).not.toHaveBeenCalled();
    await save();
    expect(state.insert).toHaveBeenCalledOnce();
    expect(state.update).toHaveBeenCalledWith(
      "new-note",
      expect.objectContaining({ bookId: "", note: "A note to move" }),
    );
    expect(state.goBack).toHaveBeenCalledOnce();
  });

  it("submits only once when the same native Save callback fires twice before a rerender", async () => {
    let finish!: () => void;
    state.insert.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    edit("One note, not two");
    const action = state.setOptions.mock.lastCall?.[0].unstable_headerRightItems()[1];
    await act(async () => {
      action.onPress();
      action.onPress();
    });
    await act(async () => finish());
    expect(state.insert).toHaveBeenCalledOnce();
    expect(state.goBack).toHaveBeenCalledOnce();
  });

  it("keeps an edited draft open through failed UPDATE, then allows the same draft to retry", async () => {
    useAnnotationStore.setState({ highlights: [original], highlightsWithBooks: [original] });
    let fail!: (reason: Error) => void;
    state.update.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
    );
    mount(original.id);
    edit("My unsaved edit");
    await save();
    const closedBeforeWrite = state.goBack.mock.calls.length;
    const disabledDuringWrite = cancelDisabled();
    await act(async () => fail(new Error("SQLITE_FULL")));
    expect(closedBeforeWrite).toBe(0);
    expect(disabledDuringWrite).toBe(true);
    expect(state.goBack).not.toHaveBeenCalled();
    expect(state.toastError).toHaveBeenCalledWith("notes.saveFailed", expect.any(Object));
    expect(cancelDisabled()).toBe(false);
    expect(useAnnotationStore.getState().highlights[0].note).toBe("Saved body");

    state.rows = [{ ...original, note: "My unsaved edit" }];
    await save();
    expect(state.update).toHaveBeenLastCalledWith(
      original.id,
      expect.objectContaining({ note: "My unsaved edit", bookId: "book-a" }),
    );
    expect(state.goBack).toHaveBeenCalledOnce();
  });

  it("keeps a new draft open on failed INSERT and retries without losing its book or text", async () => {
    state.insert.mockRejectedValueOnce(new Error("disk I/O error"));
    mount();
    edit("My new note");
    await save();
    expect(state.goBack).not.toHaveBeenCalled();
    expect(state.toastError).toHaveBeenCalledWith("notes.saveFailed", expect.any(Object));
    expect(useAnnotationStore.getState().highlights).toEqual([]);
    expect(cancelDisabled()).toBe(false);
    await save();
    expect(state.insert).toHaveBeenLastCalledWith(
      expect.objectContaining({ bookId: "book-a", note: "My new note" }),
    );
    expect(state.goBack).toHaveBeenCalledOnce();
  });
});

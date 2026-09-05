import type { ComponentProps } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import commonEn from "../../../../core/src/i18n/locales/en/common.json";
import notesEn from "../../../../core/src/i18n/locales/en/notes.json";
import commonRu from "../../../../core/src/i18n/locales/ru/common.json";
import notesRu from "../../../../core/src/i18n/locales/ru/notes.json";

const state = vi.hoisted(() => ({
  platform: "ios",
  language: "en",
  notes: [] as Array<{ id: string; bookId: string; note: string; cfi: string; text: string }>,
  goBack: vi.fn(),
  setOptions: vi.fn(),
  alert: vi.fn(),
  add: vi.fn(async () => {}),
  update: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return state.platform;
    },
  },
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
vi.mock("@/lib/notifications", () => ({ toast: { error: vi.fn() } }));
vi.mock("@readany/core/utils", () => ({ generateId: () => "new-note" }));
vi.mock("@/styles/theme", () => ({
  headingFontFamily: "system",
  spacing: { xs: 4 },
  useColors: () => ({ background: "white", foreground: "black", primary: "orange" }),
}));
vi.mock("@/stores", () => ({
  useLibraryStore: (selector: (value: unknown) => unknown) =>
    selector({
      books: [
        { id: "book-a", meta: { title: "Book A" } },
        { id: "book-b", meta: { title: "Book B" } },
      ],
    }),
  useAnnotationStore: (selector: (value: unknown) => unknown) =>
    selector({
      highlightsWithBooks: state.notes,
      addHighlight: state.add,
      updateHighlight: state.update,
    }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => {
      const dictionary: Record<string, Record<string, string>> = state.language === "ru"
        ? { ...commonRu, ...notesRu }
        : { ...commonEn, ...notesEn };
      const [namespace, name] = key.split(".");
      return dictionary[namespace]?.[name] ?? fallback;
    },
  }),
}));

import { ManualNoteScreen } from "@/screens/ManualNoteScreen";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  state.platform = "ios";
  state.language = "en";
  state.notes = [];
  vi.clearAllMocks();
  state.add.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
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
        route={{ key: "note-editor", name: "ManualNote", params: { bookId: "book-a", noteId } }}
      />,
    );
  });
}
const options = () => state.setOptions.mock.lastCall?.[0];
const cancel = () => options().unstable_headerLeftItems()[0];
function changeText(value: string) {
  act(() =>
    tree?.root.find((node) => String(node.type) === "NativeNoteEditor").props.onChange(value),
  );
}

describe("manual note iOS Cancel", () => {
  it.each([
    ["en", "Cancel"],
    ["ru", "Отмена"],
  ])("closes an empty editor in %s while preserving Book/Save", (language, label) => {
    state.language = language;
    mount();
    expect(typeof options().unstable_headerLeftItems).toBe("function");
    expect(cancel()).toMatchObject({ label, accessibilityLabel: label, disabled: false });
    expect(
      options()
        .unstable_headerRightItems()
        .map((item: { type: string }) => item.type),
    ).toEqual(["menu", "button"]);
    act(() => cancel().onPress());
    expect(state.goBack).toHaveBeenCalledOnce();
    expect(state.alert).not.toHaveBeenCalled();
    expect(state.add).not.toHaveBeenCalled();
  });

  it.each([
    ["en", "Keep editing", "Discard"],
    ["ru", "Продолжить редактирование", "Не сохранять"],
  ])(
    "confirms dirty cancellation in %s without saving or silently discarding",
    (language, keepLabel, discardLabel) => {
      state.language = language;
      mount();
      changeText("My unsaved thought");
      act(() => cancel().onPress());
      expect(state.goBack).not.toHaveBeenCalled();
      const buttons = state.alert.mock.lastCall?.[2];
      expect(buttons[0]).toMatchObject({ text: keepLabel, style: "cancel" });
      expect(buttons[1]).toMatchObject({ text: discardLabel, style: "destructive" });
      act(() => buttons[0].onPress?.());
      expect(state.goBack).not.toHaveBeenCalled();
      expect(tree?.root.find((node) => String(node.type) === "NativeNoteEditor")).toBeTruthy();
      act(() => buttons[1].onPress());
      expect(state.goBack).toHaveBeenCalledOnce();
      expect(state.add).not.toHaveBeenCalled();
      expect(state.update).not.toHaveBeenCalled();
    },
  );

  it("closes an unchanged existing note but confirms a changed book association", () => {
    state.notes = [{ id: "saved", bookId: "book-a", note: "Saved thought", cfi: "cfi", text: "" }];
    mount("saved");
    act(() => cancel().onPress());
    expect(state.alert).not.toHaveBeenCalled();
    state.goBack.mockClear();
    const bookMenu = options().unstable_headerRightItems()[0].menu;
    act(() => bookMenu.items.find((item: { label: string }) => item.label === "Book B").onPress());
    act(() => cancel().onPress());
    expect(state.alert).toHaveBeenCalledOnce();
    expect(state.goBack).not.toHaveBeenCalled();
  });

  it("leaves Android navigation actions unchanged", () => {
    state.platform = "android";
    mount();
    expect(options().unstable_headerLeftItems).toBeUndefined();
    expect(typeof options().headerRight).toBe("function");
  });

  it("still confirms when an existing note has been cleared completely", () => {
    state.notes = [{ id: "saved", bookId: "book-a", note: "Saved thought", cfi: "cfi", text: "" }];
    mount("saved");
    changeText("");
    act(() => cancel().onPress());
    expect(state.alert).toHaveBeenCalledOnce();
    expect(state.goBack).not.toHaveBeenCalled();
  });

  it("disables Cancel during a deferred save and lets only successful save close the editor", async () => {
    let finish!: () => void;
    state.add.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    changeText("Save this thought");
    await act(async () => options().unstable_headerRightItems()[1].onPress());
    expect(cancel().disabled).toBe(true);
    act(() => cancel().onPress());
    expect(state.goBack).not.toHaveBeenCalled();
    expect(state.alert).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(state.add).toHaveBeenCalledOnce();
    expect(state.add).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: "book-a",
        chapterTitle: "Заметка к книге",
        note: "Save this thought",
      }),
    );
    expect(state.goBack).toHaveBeenCalledOnce();
  });
});

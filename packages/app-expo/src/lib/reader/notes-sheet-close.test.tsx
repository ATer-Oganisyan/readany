import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import commonEn from "../../../../core/src/i18n/locales/en/common.json";
import notesEn from "../../../../core/src/i18n/locales/en/notes.json";
import commonRu from "../../../../core/src/i18n/locales/ru/common.json";
import notesRu from "../../../../core/src/i18n/locales/ru/notes.json";

const state = vi.hoisted(() => ({
  platform: "ios",
  language: "en",
  bookId: "current-reader-book",
  goBack: vi.fn(),
  navigate: vi.fn(),
  setOptions: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return state.platform;
    },
  },
  StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
vi.mock("@react-navigation/native", () => ({
  useRoute: () => ({ params: { bookId: state.bookId } }),
  useNavigation: () => ({
    goBack: state.goBack,
    navigate: state.navigate,
    setOptions: state.setOptions,
  }),
}));
vi.mock("@/styles/theme", () => ({ useColors: () => ({ background: "white" }) }));
vi.mock("@/screens/NotesView", () => ({ NotesView: "NotesView" }));
vi.mock("@/components/ui/NativeButton", () => ({ NativeButton: "NativeButton" }));
vi.mock("@/components/ui/MishanaerIcon", () => ({
  getStrokeIconImageSource: (name: string) => ({ uri: `stroke:${name}` }),
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

import { FullScreenNotesScreen } from "@/screens/FullScreenNotesScreen";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  state.platform = "ios";
  state.language = "en";
  state.goBack.mockClear();
  state.navigate.mockClear();
  state.setOptions.mockClear();
});
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
});

describe("fullscreen book notes return to reading", () => {
  it.each([
    ["en", "Close"],
    ["ru", "Закрыть"],
  ])(
    "mounts an explicit native iOS close action in %s and returns through navigation",
    (language, label) => {
      state.language = language;
      act(() => {
        tree = create(<FullScreenNotesScreen />);
      });
      expect(state.setOptions).toHaveBeenCalled();
      const options = state.setOptions.mock.lastCall?.[0];
      const buttons = options.unstable_headerRightItems();
      expect(buttons).toHaveLength(2);
      const close = buttons.find((button: { label: string }) => button.label === label);
      expect(close).toMatchObject({
        type: "button",
        label,
        accessibilityLabel: label,
        icon: { type: "image", source: { uri: "stroke:x" } },
      });
      act(() => close.onPress());
      expect(state.goBack).toHaveBeenCalledOnce();
      const addLabel = language === "ru" ? "Добавить заметку" : "Add note";
      const add = buttons.find((button: { label: string }) => button.label === addLabel);
      expect(add).toMatchObject({
        accessibilityLabel: addLabel,
        icon: { type: "image", source: { uri: "stroke:plus" } },
      });
      act(() => add.onPress());
      expect(state.navigate).toHaveBeenCalledWith("ManualNote", { bookId: state.bookId });
      const notes = tree?.root.find((node) => String(node.type) === "NotesView");
      expect(notes?.props.initialBookId).toBe(state.bookId);
      expect(notes?.props.showBackButton).toBe(false);
    },
  );

  it("adds scoped creation without replacing Android's existing back navigation", () => {
    state.platform = "android";
    act(() => {
      tree = create(<FullScreenNotesScreen />);
    });
    const options = state.setOptions.mock.lastCall?.[0];
    expect(typeof options?.headerRight).toBe("function");
    expect(options.headerLeft).toBeUndefined();
    expect(options.unstable_headerLeftItems).toBeUndefined();
    const add = options.headerRight();
    expect(add.props).toMatchObject({ accessibilityLabel: "Add note", icon: "add" });
    act(() => add.props.onPress());
    expect(state.navigate).toHaveBeenCalledWith("ManualNote", { bookId: state.bookId });
    expect(state.goBack).not.toHaveBeenCalled();
    expect(tree?.root.find((node) => String(node.type) === "NotesView").props.initialBookId).toBe(
      state.bookId,
    );
  });
});

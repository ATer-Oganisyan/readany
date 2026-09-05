import type { ComponentProps } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  KeyboardAvoidingView: "KeyboardAvoidingView",
  TouchableOpacity: "TouchableOpacity",
  View: "View",
}));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("@/components/chat/MarkdownRenderer", () => ({ MarkdownRenderer: "MarkdownRenderer" }));
vi.mock("@/components/ui/Icon", () => ({
  CheckIcon: "Icon",
  EditIcon: "Icon",
  Trash2Icon: "Icon",
  XIcon: "Icon",
}));
vi.mock("@/components/ui/RichTextEditor", () => ({ RichTextEditor: "RichTextEditor" }));
vi.mock("@/styles/theme", () => ({ useColors: () => ({ amber: "yellow" }) }));
vi.mock("@/screens/notes/notes-styles", () => ({ makeStyles: () => ({}) }));
vi.mock("@readany/core/types", () => ({ HIGHLIGHT_COLOR_HEX: { yellow: "yellow" } }));
import { NoteCard } from "@/screens/notes/NoteCard";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined;
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
});
function mount(text: string) {
  const props = {
    highlight: { id: "own-note", text, note: "Own book note", color: "yellow" },
    isEditing: false,
    editNote: "",
    setEditNote: vi.fn(),
    onStartEdit: vi.fn(),
    onSaveNote: vi.fn(),
    onCancelEdit: vi.fn(),
    onDeleteNote: vi.fn(),
    onNavigate: vi.fn(),
    t: (key: string) => key,
  } as unknown as ComponentProps<typeof NoteCard>;
  act(() => {
    tree = create(<NoteCard {...props} />);
  });
  return props;
}
describe("book note cards", () => {
  it.each(["", "   "])("does not render fake quotation or color marker for text %j", (text) => {
    const props = mount(text);
    const links = tree?.root.findAll(
      (node) => String(node.type) === "TouchableOpacity" && node.props.onPress === props.onNavigate,
    );
    expect(links).toHaveLength(1); // note body remains navigable, no empty quote link
    expect(tree?.root.findAll((node) => String(node.type) === "Text")).toHaveLength(0);
  });
  it("preserves a real quote and its navigation", () => {
    const props = mount("Actual quoted text");
    const text = tree?.root.find((node) => String(node.type) === "Text");
    expect(text?.props.children).toContain("Actual quoted text");
    const links = tree?.root.findAll(
      (node) => String(node.type) === "TouchableOpacity" && node.props.onPress === props.onNavigate,
    );
    expect(links).toHaveLength(2);
    act(() => links?.[0].props.onPress());
    expect(props.onNavigate).toHaveBeenCalledOnce();
  });
  it("exposes edit and delete actions by accessible names", () => {
    const props = mount("");
    const edit = tree?.root.findByProps({ accessibilityLabel: "notes.editNote" });
    const remove = tree?.root.findByProps({ accessibilityLabel: "common.delete" });
    act(() => edit?.props.onPress());
    act(() => remove?.props.onPress());
    expect(props.onStartEdit).toHaveBeenCalledOnce();
    expect(props.onDeleteNote).toHaveBeenCalledOnce();
  });
});

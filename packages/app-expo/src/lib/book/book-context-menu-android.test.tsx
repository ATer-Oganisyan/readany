import { BookCardContextMenu } from "@/components/library/BookCardContextMenu.android";
import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  View: "View",
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/styles/theme", () => ({
  radius: { sm: 6 },
  useColors: () => ({ primary5: "#eee", card: "#fff", destructive: "#f00" }),
}));
vi.mock("@deslop/primitives/native", () => ({
  interfaceFontFamily: { regular: "sans-serif" },
}));
vi.mock("@/components/ui/MishanaerIcon", () => ({
  getStrokeIconImageSource: () => 1,
  resolveSystemIconName: (name: string) => name,
}));
vi.mock("@expo/ui/jetpack-compose", () => ({
  Host: "Host",
  RNHostView: "RNHostView",
  Icon: "Icon",
  IconButton: "IconButton",
  Text: "Text",
  DropdownMenu: Object.assign((props: object) => createElement("DropdownMenu", props), {
    Items: "Items",
  }),
  DropdownMenuItem: Object.assign((props: object) => createElement("DropdownMenuItem", props), {
    Text: "ItemText",
    LeadingIcon: "ItemIcon",
  }),
}));
vi.mock("@expo/ui/jetpack-compose/modifiers", () => ({ size: vi.fn() }));

it("opens the book on tap and offers deletion only through the long-press menu", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(
      <BookCardContextMenu
        accessibilityLabel="Действия с книгой"
        onPress={onOpen}
        items={[{ key: "delete", label: "Удалить", destructive: true, onPress: onDelete }]}
      >
        <div />
      </BookCardContextMenu>,
    );
  });
  const trigger = () => renderer.root.findByType("Pressable" as never);
  const menu = () => renderer.root.findByType("DropdownMenu" as never);
  expect(menu().props.expanded).toBe(false);
  act(() => trigger().props.onPress());
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(menu().props.expanded).toBe(false);
  act(() => trigger().props.onLongPress());
  expect(menu().props.expanded).toBe(true);
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onDelete).not.toHaveBeenCalled();
  act(() => menu().props.onDismissRequest());
  expect(menu().props.expanded).toBe(false);
  expect(onDelete).not.toHaveBeenCalled();
  act(() => trigger().props.onLongPress());
  act(() => renderer.root.findByType("DropdownMenuItem" as never).props.onClick());
  expect(menu().props.expanded).toBe(false);
  expect(onDelete).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});

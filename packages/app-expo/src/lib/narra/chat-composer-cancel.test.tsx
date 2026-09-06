import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  View: "View", Pressable: "Pressable", StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/styles/theme", () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/ui/MishanaerIcon", () => ({ MishanaerIcon: "Icon" }));
vi.mock("panelui-native", async () => {
  const { createElement } = await import("react");
  return { AIInput: Object.assign(
    ({ children, ...props }: { children?: import("react").ReactNode }) => createElement("AIInput", props, children),
    { Row: "Row", Field: "Field" },
  ) };
});
import { NarraChatComposer } from "../../components/chat/narra-chat-composer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });

it("changes Send into a visually distinct enabled Stop, then restores Send", async () => {
  const onSend = vi.fn();
  const onStop = vi.fn();
  const render = (isStreaming: boolean) => <NarraChatComposer text="Вопрос" isStreaming={isStreaming} onSend={onSend} onStop={onStop} />;
  await act(async () => { tree = create(render(false)); });
  expect(tree.root.findByType("Icon" as never).props.name).toBe("arrow-up");
  await act(async () => { tree.root.findByProps({ accessibilityLabel: "narra.send" }).props.onPress(); });
  expect(onSend).toHaveBeenCalledWith({ text: "Вопрос" }, true);
  await act(async () => { tree.update(render(true)); });
  const stop = tree.root.findByProps({ accessibilityLabel: "common.stop" });
  expect(stop.props.disabled).toBe(false);
  expect(tree.root.findByType("Icon" as never).props.name).toBe("stop");
  expect(tree.root.findByType("Icon" as never).props.variant).toBe("filled");
  await act(async () => { stop.props.onPress(); });
  expect(onStop).toHaveBeenCalledOnce();
  expect(onSend).toHaveBeenCalledTimes(1);
  await act(async () => { tree.update(render(false)); });
  expect(tree.root.findByType("Icon" as never).props.name).toBe("arrow-up");
  expect(tree.root.findByProps({ accessibilityLabel: "narra.send" }).props.disabled).toBe(false);
});

it("keeps Stop enabled with an empty composer while an answer is pending", async () => {
  const onStop = vi.fn();
  await act(async () => { tree = create(<NarraChatComposer text="" isStreaming onStop={onStop} />); });
  const stop = tree.root.findByProps({ accessibilityLabel: "common.stop" });
  expect(stop.props.disabled).toBe(false);
  await act(async () => { stop.props.onPress(); });
  expect(onStop).toHaveBeenCalledOnce();
});

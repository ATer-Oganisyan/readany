import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({
  View: "View",
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("expo", () => ({ requireNativeView: () => "NativeToolbar" }));
vi.mock("@/components/ui/MishanaerIcon", () => ({
  getFilledIconImageSource: (name: string) => name,
}));
vi.mock("@expo/ui/jetpack-compose", () => ({
  Host: "Host",
  HorizontalFloatingToolbar: "Toolbar",
  Icon: "Icon",
  IconButton: "IconButton",
  CircularProgressIndicator: "Spinner",
}));
vi.mock("@expo/ui/jetpack-compose/modifiers", () => ({ size: () => ({}) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { ReaderToolbar as AndroidToolbar } from "../../screens/reader/ReaderToolbar.android";
import { ReaderToolbar as IosToolbar } from "../../screens/reader/ReaderToolbar.ios";
import type { ReaderToolbarProps } from "../../screens/reader/ReaderToolbar.types";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});
function props(speechState: string): ReaderToolbarProps {
  return {
    speechState,
    tintColor: "black",
    isDark: false,
    onSpeechPress: vi.fn(),
    onCharactersPress: vi.fn(),
  } as ReaderToolbarProps;
}
it("Android preparation offers an enabled, named cancel action", async () => {
  const input = props("preparing");
  await act(async () => {
    tree = create(<AndroidToolbar {...input} />);
  });
  expect(
    tree.root.findByProps({ contentDescription: "reader.cancelAudioPreparation" }).props.source,
  ).toBe("stop");
  const button = tree.root.findAll((node) => (node.type as unknown) === "IconButton")[0];
  expect(button.props.enabled).toBe(true);
  button.props.onClick();
  expect(input.onSpeechPress).toHaveBeenCalledOnce();
});
it("iOS preparation uses the enabled stop control, not the disabled audio spinner", async () => {
  const input = props("preparing");
  await act(async () => {
    tree = create(<IosToolbar {...input} />);
  });
  const native = tree.root.find((node) => (node.type as unknown) === "NativeToolbar");
  expect(native.props.speechActive).toBe(true);
  expect(native.props.speechLoading).toBe(false);
  expect(native.props.speechStopLabel).toBe("reader.cancelAudioPreparation");
  native.props.onSpeechPress();
  expect(input.onSpeechPress).toHaveBeenCalledOnce();
});
it("iOS playing retains its localized Stop action", async () => {
  await act(async () => {
    tree = create(<IosToolbar {...props("playing")} />);
  });
  expect(tree.root.find((node) => (node.type as unknown) === "NativeToolbar").props.speechStopLabel).toBe("tts.stopShort");
});

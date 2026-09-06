import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable" }));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { ReaderTTSPreparationStatus } from "../../screens/reader/reader-tts-preparation-status";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});
it.each([
  [true, null, "reader.preparingAudioText"],
  [false, "empty", "reader.audioPreparationEmpty"],
  [false, "failed", "reader.audioPreparationFailed"],
] as const)("exposes preparation/error status: %s %s", async (preparing, error, message) => {
  await act(async () => {
    tree = create(
      <ReaderTTSPreparationStatus
        preparing={preparing}
        error={error}
        foreground="black"
        background="white"
      />,
    );
  });
  const text = tree.root.find((node) => (node.type as unknown) === "Text");
  expect(text.props.children).toBe(message);
  expect(text.props.accessibilityLiveRegion).toBe("polite");
  expect(text.props.accessibilityRole).toBe(error ? "alert" : "text");
});
it("does not leave a stale status after preparation completes", async () => {
  await act(async () => {
    tree = create(
      <ReaderTTSPreparationStatus
        preparing={false}
        error={null}
        foreground="black"
        background="white"
      />,
    );
  });
  expect(tree.toJSON()).toBeNull();
});

it.each([true, false])(
  "offers an explicit cancel during preparation=%s and audio loading",
  async (preparing) => {
    const onCancel = vi.fn();
    await act(async () => {
      tree = create(
        <ReaderTTSPreparationStatus
          preparing={preparing}
          loading={!preparing}
          error={null}
          foreground="black"
          background="white"
          onCancel={onCancel}
        />,
      );
    });
    const button = tree.root.findByProps({ accessibilityRole: "button" });
    expect(button.props.accessibilityLabel).toBe("common.cancel");
    expect(button.props.style.minHeight).toBe(48);
    button.props.onPress();
    expect(onCancel).toHaveBeenCalledOnce();
    const status = tree.root.findByProps({ accessibilityLiveRegion: "polite" });
    expect(status.props.children).toBe(
      preparing ? "reader.preparingAudioText" : "reader.loadingAudioText",
    );
  },
);

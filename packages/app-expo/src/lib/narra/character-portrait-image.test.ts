import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Image: "Image", View: "View", StyleSheet: { create: (x: unknown) => x } }));
vi.mock("expo-asset", () => ({ Asset: {} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_: string, text: string) => text }) }));
vi.mock("@/components/narra/NarraLoopVideo", () => ({ NarraLoopVideo: "Video" }));
vi.mock("@/lib/narra/character-portrait", () => ({
  resolveCharacterPortraitSources: (character: { portraitUri?: string }) => character.portraitUri
    ? [{ uri: character.portraitUri }, { uri: "backup" }] : [],
  resolveCharacterPortraitVideoAsset: () => undefined,
}));
import { CharacterPortraitImage } from "../../components/narra/character-portrait-image";

it("reports unavailable only after all sources fail, and retries a new portrait", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const onUnavailable = vi.fn();
  const props = { character: { portraitUri: "first" }, fallback: null, staticOnly: true, onUnavailable };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(CharacterPortraitImage, props)); });
  await act(async () => { tree.root.findByType("Image" as never).props.onError(); });
  expect(onUnavailable).not.toHaveBeenCalled();
  expect(tree.root.findByType("Image" as never).props.source.uri).toBe("backup");
  await act(async () => { tree.root.findByType("Image" as never).props.onError(); });
  expect(onUnavailable).toHaveBeenCalledTimes(1);
  await act(async () => { tree.update(createElement(CharacterPortraitImage, { ...props, character: { portraitUri: "new" } })); });
  expect(tree.root.findByType("Image" as never).props.source.uri).toBe("new");
  act(() => tree.unmount());
});

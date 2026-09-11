import { AudiobookPlayerContent } from "@/components/tts/audiobook-player-content.android";
import type { AudiobookPlayerContentProps } from "@/components/tts/audiobook-player-content.types";
import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/styles/ThemeContext", () => ({ useTheme: () => ({ colors: {}, isDark: false }) }));
vi.mock("@/components/ui/MishanaerIcon", () => ({ getStrokeIconImageSource: () => 1 }));
vi.mock("@expo/ui/jetpack-compose", () => ({
  Host: "Host",
  Column: "Column",
  Row: "Row",
  Slider: "Slider",
  Text: "Text",
  Icon: "Icon",
  IconButton: "IconButton",
  DropdownMenu: Object.assign((props: object) => createElement("Menu", props), {
    Items: "Items",
    Trigger: "Trigger",
  }),
  DropdownMenuItem: Object.assign((props: object) => createElement("MenuItem", props), {
    Text: "ItemText",
  }),
}));
vi.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  fillMaxWidth: vi.fn(),
  padding: vi.fn(),
  size: vi.fn(),
  weight: vi.fn(),
}));

it("uses sentence actions and chapter boundaries instead of timed seeking on Android", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const previous = vi.fn();
  const next = vi.fn();
  const seekBackward = vi.fn();
  const seekForward = vi.fn();
  const props = {
    title: "Book",
    chapter: "Chapter",
    player: { hasDuration: false, duration: 0, seekBackward, seekForward },
    onPreviousSentence: previous,
    onNextSentence: next,
    canGoToPreviousSentence: true,
    canGoToNextSentence: true,
  } as unknown as AudiobookPlayerContentProps;
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(<AudiobookPlayerContent {...props} />);
  });
  const button = (label: string) =>
    tree.root
      .findAllByType("IconButton" as never)
      .find((node) => node.findByType("Icon" as never).props.contentDescription === label)!;
  try {
    expect(button("tts.prevSentence").props.enabled).toBe(true);
    expect(button("tts.nextSentence").props.enabled).toBe(true);
    act(() => {
      button("tts.prevSentence").props.onClick();
      button("tts.nextSentence").props.onClick();
    });
    expect(previous).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(seekBackward).not.toHaveBeenCalled();
    expect(seekForward).not.toHaveBeenCalled();
    for (const [canGoToPreviousSentence, canGoToNextSentence] of [
      [false, true],
      [true, false],
      [false, false],
    ]) {
      act(() =>
        tree.update(
          <AudiobookPlayerContent
            {...props}
            player={{ ...props.player, hasDuration: true }}
            canGoToPreviousSentence={canGoToPreviousSentence}
            canGoToNextSentence={canGoToNextSentence}
          />,
        ),
      );
      expect(button("tts.prevSentence").props.enabled).toBe(canGoToPreviousSentence);
      expect(button("tts.nextSentence").props.enabled).toBe(canGoToNextSentence);
    }
  } finally {
    act(() => tree.unmount());
  }
});

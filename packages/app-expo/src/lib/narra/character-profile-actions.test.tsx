import { readFileSync } from "node:fs";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type { ReaderCharacterActionsProps } from "@/screens/reader/ReaderCharacterActions.types";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  character: {
    id: "hero",
    backendManaged: true,
    unlockProgress: 0,
    portraitUri: "file:///portrait",
  },
  book: { id: "book", progress: 0.5 },
  hasCharacter: true,
  backendStatus: {} as { error?: string; manifest?: { availability: string } },
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios", Version: 26 },
  View: "View",
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock("@expo/ui/swift-ui", () => ({
  Button: "Button",
  GlassEffectContainer: "GlassEffectContainer",
  HStack: "HStack",
  Host: "Host",
}));
vi.mock("@expo/ui/swift-ui/modifiers", () =>
  Object.fromEntries(
    [
      "accessibilityLabel",
      "buttonStyle",
      "controlSize",
      "disabled",
      "frame",
      "glassEffect",
      "labelStyle",
      "tint",
    ].map((name) => [name, (value: unknown) => ({ name, value })]),
  ),
);
vi.mock("@/components/ui/HostedMishanaerIcon", () => ({ HostedMishanaerIcon: "HostedIcon" }));
vi.mock("@/components/ui/centered-empty-state", () => ({ CenteredEmptyState: "EmptyState" }));
vi.mock("@/components/ui/empty-state-action-button", () => ({
  EmptyStateActionButton: "RetryButton",
}));
vi.mock("@/lib/narra/backend-book-sync", () => ({
  useBackendBookStatus: (select: (state: unknown) => unknown) =>
    select({ books: { book: runtime.backendStatus } }),
  retryBackendBookSync: vi.fn(),
}));
vi.mock("@/hooks/use-backend-book", () => ({ useBackendBook: vi.fn() }));
vi.mock("@/lib/library/open-mobile-book", () => ({ openMobileBook: vi.fn() }));
vi.mock("@/lib/narra/character-portrait", () => ({
  hasCharacterPortrait: () => Boolean(runtime.character.portraitUri),
}));
vi.mock("@/styles/theme", () => ({ useTheme: () => ({ colors: { card: "#fff" } }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, text: string) => text }),
}));
vi.mock("@/stores", () => ({
  useLibraryStore: (select: (state: unknown) => unknown) => select({ books: [runtime.book] }),
  useNarraStore: (select: (state: unknown) => unknown) =>
    select({ books: { book: { characters: runtime.hasCharacter ? [runtime.character] : [] } } }),
}));
vi.mock("@/screens/reader/ReaderCharacterCard", () => ({ ReaderCharacterCard: "CharacterCard" }));

import { retryBackendBookSync } from "@/lib/narra/backend-book-sync";
import { NarraCharacterProfileScreen } from "@/screens/NarraCharacterProfileScreen";
import { ReaderCharacterActions } from "@/screens/reader/ReaderCharacterActions.ios";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
beforeEach(() => {
  runtime.hasCharacter = true;
  runtime.character.backendManaged = true;
  runtime.character.unlockProgress = 0;
  runtime.character.portraitUri = "file:///portrait";
  runtime.book.progress = 0.5;
  runtime.backendStatus = {};
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
});

const props: ReaderCharacterActionsProps = {
  talkLabel: "Написать",
  listenLabel: "Озвучить",
  stopLabel: "Стоп",
  regenerateLabel: "Повторить",
  onTalk: vi.fn(),
  onToggleVoice: vi.fn(),
  onRegenerate: vi.fn(),
  canSample: true,
  regenerating: false,
  showRegenerate: true,
  voiceState: "idle",
  isDark: false,
  foregroundColor: "#111",
  primaryForegroundColor: "#fff",
};

describe("character profile actions", () => {
  const screenProps = () =>
    ({
      route: { params: { bookId: "book", characterId: "hero" } },
      navigation: { setOptions: vi.fn(), replace: vi.fn(), goBack: vi.fn() },
    }) as unknown as NativeStackScreenProps<RootStackParamList, "NarraCharacterProfile">;

  it("waits for first profile data without flashing unavailable, then renders the card", () => {
    runtime.hasCharacter = false;
    const props = screenProps();
    act(() => {
      tree = create(<NarraCharacterProfileScreen {...props} />);
    });
    expect(tree.root.findAll((node) => String(node.type) === "EmptyState")).toHaveLength(0);
    expect(tree.root.findAll((node) => String(node.type) === "ActivityIndicator")).toHaveLength(1);
    runtime.hasCharacter = true;
    act(() => {
      tree.update(<NarraCharacterProfileScreen {...props} />);
    });
    expect(tree.root.findAll((node) => String(node.type) === "CharacterCard")).toHaveLength(1);
    expect(tree.root.findAll((node) => String(node.type) === "ActivityIndicator")).toHaveLength(0);
  });

  it("renders the card immediately while its portrait is still loading", () => {
    runtime.character.portraitUri = "";
    act(() => {
      tree = create(<NarraCharacterProfileScreen {...screenProps()} />);
    });
    expect(tree.root.findAll((node) => String(node.type) === "CharacterCard")).toHaveLength(1);
  });

  it("delegates locked profiles to the card's spoiler-safe teaser instead of unavailable", () => {
    runtime.character.unlockProgress = 0.75;
    const props = screenProps();
    act(() => {
      tree = create(<NarraCharacterProfileScreen {...props} />);
    });
    expect(tree.root.findAll((node) => String(node.type) === "CharacterCard")).toHaveLength(1);
    expect(props.navigation.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ sheetAllowedDetents: "fitToContents" }),
    );
  });

  it.each(["error", "missing"])("offers retry if the profile cannot load (%s)", (reason) => {
    runtime.hasCharacter = false;
    runtime.backendStatus =
      reason === "error" ? { error: "offline" } : { manifest: { availability: "ready" } };
    act(() => {
      tree = create(<NarraCharacterProfileScreen {...screenProps()} />);
    });
    act(() => tree.root.find((node) => String(node.type) === "RetryButton").props.onPress());
    expect(retryBackendBookSync).toHaveBeenCalledWith("book");
    expect(tree.root.findAll((node) => String(node.type) === "ActivityIndicator")).toHaveLength(0);
  });

  it("presents the standalone iOS chat as a sheet above the modal reader", () => {
    const navigator = readFileSync(
      new URL("../../navigation/RootNavigator.tsx", import.meta.url),
      "utf8",
    );
    const reader = navigator.split('name="Reader"')[1].split("</Stack.Screen>")[0].split("/>")[0];
    const chat = navigator.split('name="NarraCharacterChat"')[1].split("/>")[0];
    expect(reader).toContain('presentation: "fullScreenModal"');
    expect(chat).toContain('presentation: Platform.OS === "ios" ? "formSheet" : "card"');
    expect(chat).toContain("sheetAllowedDetents: [1]");
    expect(chat).toContain("sheetGrabberVisible: true");
    expect(chat).toContain(
      'Platform.OS === "ios" && isDark ? colors.elevation2 : colors.background',
    );
    expect(chat).not.toContain('presentation: "card"');

    expect(navigator).toContain("function NarraCharacterChatRouteScreen");
    expect(navigator).toContain("<ElevatedSurfaceTheme>");
    expect(navigator).toContain("component={NarraCharacterChatRouteScreen}");
  });

  it("gives all native buttons a full 64-point label and forwards the talk action", () => {
    act(() => {
      tree = create(<ReaderCharacterActions {...props} />);
    });
    const icons = tree.root.findAll((node) => String(node.type) === "HostedIcon");
    expect(icons).toHaveLength(3);
    for (const icon of icons) expect(icon.props.box).toBe(64);
    expect(icons[2].props).toMatchObject({ name: "arrow-rotate-ccw-up", variant: "filled" });
    act(() => tree.root.findAll((node) => String(node.type) === "Button")[0].props.onPress());
    expect(props.onTalk).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "opens chat or returns to the existing chat (openedFromChat=%s)",
    (openedFromChat) => {
      const navigation = { setOptions: vi.fn(), replace: vi.fn(), goBack: vi.fn() };
      const screenProps = {
        route: { params: { bookId: "book", characterId: "hero", openedFromChat } },
        navigation,
      } as unknown as NativeStackScreenProps<RootStackParamList, "NarraCharacterProfile">;
      act(() => {
        tree = create(<NarraCharacterProfileScreen {...screenProps} />);
      });
      act(() =>
        tree.root
          .find((node) => String(node.type) === "CharacterCard")
          .props.onOpenChat(runtime.character),
      );
      if (openedFromChat) {
        expect(navigation.goBack).toHaveBeenCalledTimes(1);
        expect(navigation.replace).not.toHaveBeenCalled();
      } else {
        expect(navigation.replace).toHaveBeenCalledWith("NarraCharacterChat", {
          bookId: "book",
          characterId: "hero",
        });
        expect(navigation.goBack).not.toHaveBeenCalled();
      }
    },
  );

  it("keeps the real card talk buttons wired to the profile callback", () => {
    const card = readFileSync(
      new URL("../../screens/reader/ReaderCharacterCard.tsx", import.meta.url),
      "utf8",
    );
    expect(card.match(/onTalk=\{\(\) => onOpenChat\(character\)\}/g)).toHaveLength(2);
    expect(card).toContain('label: t("narra.bio", "Био")');
  });

  it("shows a static portrait on the character profile", () => {
    const navigation = { setOptions: vi.fn(), replace: vi.fn(), goBack: vi.fn() };
    const screenProps = {
      route: { params: { bookId: "book", characterId: "hero" } },
      navigation,
    } as unknown as NativeStackScreenProps<RootStackParamList, "NarraCharacterProfile">;

    act(() => {
      tree = create(<NarraCharacterProfileScreen {...screenProps} />);
    });

    expect(tree.root.find((node) => String(node.type) === "CharacterCard").props).toMatchObject({
      staticPortraitOnly: true,
    });
  });
});

import { Text as InterfaceText } from "@/components/ui/Typography";
import { getBundledCatalogCharactersById } from "@/lib/narra/bundled-catalog-characters";
import type { NarraCharacter } from "@/lib/narra/types";
import { ReaderCharacterCard } from "@/screens/reader/ReaderCharacterCard";
import { spacing } from "@/styles/theme";
import { interfaceFontFamily, serifTextFontFamily } from "@deslop/primitives/native";
import { NavigationContainer } from "@react-navigation/native";
import {
  type NativeStackScreenProps,
  createNativeStackNavigator,
} from "@react-navigation/native-stack";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type ReaderCharacterCardPreviewTheme = "light" | "sepia" | "dark";
export type ReaderCharacterAvatarState = "ready" | "generating";

interface ReaderCharacterCardPreviewProps {
  readerTheme?: ReaderCharacterCardPreviewTheme;
  fontSize?: number;
  initiallyOpen?: boolean;
  avatarState?: ReaderCharacterAvatarState;
}

const READER_COLORS = {
  light: {
    background: "#F7F7F5",
    foreground: "#171717",
    muted: "#8B8B8B",
  },
  sepia: {
    background: "#F4ECD8",
    foreground: "#312A20",
    muted: "#877B6A",
  },
  dark: {
    background: "#151515",
    foreground: "#F1EEE8",
    muted: "#96928C",
  },
} as const;

const STORYBOOK_BOOK_ID = "storybook-anna-karenina";
type ProfilePreviewStackParamList = {
  Reader: undefined;
  CharacterProfile: undefined;
};
const ProfilePreviewStack = createNativeStackNavigator<ProfilePreviewStackParamList>();
const bundledAnna = getBundledCatalogCharactersById("anna-karenina")?.[0];

if (!bundledAnna) {
  throw new Error("Storybook character fixture is unavailable");
}

const STORYBOOK_CHARACTER: NarraCharacter = {
  ...bundledAnna,
  // В стенде не запускаем синтез речи или другие сетевые действия.
  voice: "",
  greeting: "",
  speechExamples: [],
};

const STORYBOOK_CHARACTER_WITHOUT_AVATAR: NarraCharacter = {
  ...STORYBOOK_CHARACTER,
  portraitAssetId: undefined,
  portraitUri: undefined,
  portraitUriOverridesAsset: false,
};

function ProfilePreviewReader({
  navigation,
}: NativeStackScreenProps<ProfilePreviewStackParamList, "Reader">) {
  useEffect(() => {
    navigation.navigate("CharacterProfile");
  }, [navigation]);

  return (
    <View
      style={[styles.profilePreviewBackground, { backgroundColor: READER_COLORS.light.background }]}
    >
      <InterfaceText style={[styles.eyebrow, { color: READER_COLORS.light.muted }]}>
        ЛЕВ ТОЛСТОЙ
      </InterfaceText>
      <Text style={[styles.chapterTitle, { color: READER_COLORS.light.foreground }]}>
        Анна Каренина
      </Text>
    </View>
  );
}

export function NarraCharacterProfileGeneratingPreview() {
  return (
    <NavigationContainer>
      <ProfilePreviewStack.Navigator
        initialRouteName="Reader"
        screenOptions={{ headerShown: false }}
      >
        <ProfilePreviewStack.Screen name="Reader" component={ProfilePreviewReader} />
        <ProfilePreviewStack.Screen
          name="CharacterProfile"
          options={{
            presentation: "formSheet",
            animation: "slide_from_bottom",
            headerShown: false,
            sheetAllowedDetents: "fitToContents",
            sheetInitialDetentIndex: 0,
            sheetGrabberVisible: true,
            sheetExpandsWhenScrolledToEdge: false,
            sheetResizeAnimationEnabled: true,
            contentStyle: { backgroundColor: "#2C2219" },
          }}
        >
          {() => (
            <View style={styles.profilePreviewCompactContent}>
              <ReaderCharacterCard
                embedded
                visible
                character={STORYBOOK_CHARACTER_WITHOUT_AVATAR}
                bookId={STORYBOOK_BOOK_ID}
                onClose={() => undefined}
                onOpenChat={() => undefined}
                portraitLoadingPreview
              />
            </View>
          )}
        </ProfilePreviewStack.Screen>
      </ProfilePreviewStack.Navigator>
    </NavigationContainer>
  );
}

export function ReaderCharacterCardPreview({
  readerTheme = "light",
  fontSize = 21,
  initiallyOpen = false,
  avatarState = "ready",
}: ReaderCharacterCardPreviewProps) {
  const insets = useSafeAreaInsets();
  const colors = READER_COLORS[readerTheme];
  const [visible, setVisible] = useState(initiallyOpen);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const lineHeight = Math.round(fontSize * 1.58);
  const character = useMemo<NarraCharacter>(
    () =>
      avatarState === "generating"
        ? {
            ...STORYBOOK_CHARACTER,
            portraitAssetId: undefined,
            portraitUri: undefined,
            portraitUriOverridesAsset: false,
          }
        : STORYBOOK_CHARACTER,
    [avatarState],
  );

  useEffect(() => {
    setVisible(initiallyOpen);
    setNoticeVisible(false);
  }, [initiallyOpen]);

  useEffect(() => {
    if (!noticeVisible) return;
    const timeout = setTimeout(() => setNoticeVisible(false), 1800);
    return () => clearTimeout(timeout);
  }, [noticeVisible]);

  const readerTextStyle = useMemo(
    () => [
      styles.readerText,
      {
        color: colors.foreground,
        fontSize,
        lineHeight,
      },
    ],
    [colors.foreground, fontSize, lineHeight],
  );

  const openCharacter = () => {
    setNoticeVisible(false);
    setVisible(true);
  };

  const openChat = () => {
    setVisible(false);
    setNoticeVisible(true);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.bookContent,
          {
            paddingTop: Math.max(insets.top, spacing.lg) + 76,
            paddingBottom: Math.max(insets.bottom, spacing.xl) + 88,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.chapterHeading}>
          <InterfaceText style={[styles.eyebrow, { color: colors.muted }]}>
            ЛЕВ ТОЛСТОЙ
          </InterfaceText>
          <Text style={[styles.chapterTitle, { color: colors.foreground }]}>Анна Каренина</Text>
        </View>

        <Text style={readerTextStyle}>
          Все смешалось в доме Облонских. Жена узнала, что муж был в связи с бывшею в их доме
          француженкою-гувернанткой, и объявила мужу, что не может жить с ним в одном доме.
        </Text>

        <Text style={readerTextStyle}>
          Положение это продолжалось уже третий день и мучительно чувствовалось и самими супругами,
          и всеми членами семьи, и домочадцами.
        </Text>

        <Text style={readerTextStyle}>
          К вечеру приехала его сестра,{" "}
          <Text
            accessibilityRole="button"
            accessibilityLabel="Открыть карточку Анны Карениной"
            onPress={openCharacter}
            suppressHighlighting={false}
            style={[styles.characterName, { color: colors.foreground }]}
          >
            Анна
          </Text>
          , и дом на несколько мгновений словно вспомнил прежний порядок. Она вошла быстро, легко, с
          той особенной ясностью взгляда, которая сразу располагала к доверию.
        </Text>

        <View style={[styles.hint, { borderColor: colors.muted }]}>
          <InterfaceText style={[styles.hintText, { color: colors.muted }]}>
            Нажмите на подчёркнутое имя
          </InterfaceText>
        </View>
      </ScrollView>

      <View style={[styles.topInfo, { top: Math.max(insets.top, spacing.lg) + spacing.sm }]}>
        <InterfaceText style={[styles.topInfoText, { color: colors.muted }]}>Глава I</InterfaceText>
        <InterfaceText style={[styles.topInfoText, styles.tabular, { color: colors.muted }]}>
          12 / 438
        </InterfaceText>
      </View>

      {noticeVisible ? (
        <View style={[styles.notice, { bottom: Math.max(insets.bottom, spacing.lg) + spacing.lg }]}>
          <InterfaceText style={styles.noticeText}>Здесь откроется чат с Анной</InterfaceText>
        </View>
      ) : null}

      <ReaderCharacterCard
        visible={visible}
        character={character}
        bookId={STORYBOOK_BOOK_ID}
        onClose={() => setVisible(false)}
        onOpenChat={openChat}
        portraitLoadingPreview={avatarState === "generating"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bookContent: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    gap: spacing.xl,
    paddingHorizontal: 30,
  },
  chapterHeading: { alignItems: "center", gap: spacing.sm, paddingBottom: spacing.xl },
  eyebrow: {
    fontFamily: interfaceFontFamily.caps,
    fontSize: 11,
    letterSpacing: 1.8,
  },
  chapterTitle: {
    fontFamily: serifTextFontFamily.bold,
    fontSize: 28,
    lineHeight: 34,
    textAlign: "center",
  },
  readerText: {
    fontFamily: serifTextFontFamily.regular,
  },
  characterName: {
    fontFamily: serifTextFontFamily.bold,
    textDecorationLine: "underline",
    textDecorationStyle: "dashed",
    textDecorationColor: "rgba(127, 127, 127, 0.65)",
  },
  hint: {
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
  },
  hintText: { fontFamily: interfaceFontFamily.regular, fontSize: 12 },
  topInfo: {
    position: "absolute",
    left: 22,
    right: 22,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  topInfoText: { fontFamily: interfaceFontFamily.regular, fontSize: 12 },
  tabular: { fontVariant: ["tabular-nums"] },
  notice: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(23, 23, 23, 0.92)",
  },
  noticeText: {
    color: "#FFFFFF",
    fontFamily: interfaceFontFamily.semibold,
    fontSize: 13,
  },
  profilePreviewBackground: {
    flex: 1,
    alignItems: "center",
    paddingTop: 120,
    gap: spacing.sm,
  },
  profilePreviewCompactContent: {
    backgroundColor: "#2C2219",
  },
});

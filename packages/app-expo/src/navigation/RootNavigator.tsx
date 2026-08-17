import { MissingBookPrompt } from "@/components/shared/MissingBookPrompt";
import BadgesScreen from "@/screens/BadgesScreen";
import { ChatScreen } from "@/screens/ChatScreen";
import { FullScreenNotesScreen } from "@/screens/FullScreenNotesScreen";
import { ManualNoteScreen } from "@/screens/ManualNoteScreen";
import { NarraCharacterChatScreen } from "@/screens/NarraCharacterChatScreen";
import { NarraCharacterProfileScreen } from "@/screens/NarraCharacterProfileScreen";
import { NarraCharactersScreen } from "@/screens/NarraCharactersScreen";
import { NarraSceneScreen } from "@/screens/NarraSceneScreen";
import { NarraSummaryScreen } from "@/screens/NarraSummaryScreen";
import { ReaderScreen } from "@/screens/ReaderScreen";
import SkillsScreen from "@/screens/SkillsScreen";
import StatsScreen from "@/screens/StatsScreen";
import {
  StorybookPreviewScreen,
  StorybookScreen,
  getStorybookItemTitle,
} from "@/screens/StorybookScreen";
import { WebDavImportBrowserScreen } from "@/screens/library/WebDavImportBrowserScreen";
import { ReaderTOCSheetScreen } from "@/screens/reader/reader-toc-sheet-screen";
import AISettingsScreen from "@/screens/settings/AISettingsScreen";
import AboutScreen from "@/screens/settings/AboutScreen";
import AppearanceSettingsScreen from "@/screens/settings/AppearanceSettingsScreen";
import FontSettingsScreen from "@/screens/settings/FontSettingsScreen";
import SyncSettingsScreen from "@/screens/settings/SyncSettingsScreen";
import TTSSettingsScreen from "@/screens/settings/TTSSettingsScreen";
import TranslationSettingsScreen from "@/screens/settings/TranslationSettingsScreen";
import VectorModelSettingsScreen from "@/screens/settings/VectorModelSettingsScreen";
import { useSettingsStore } from "@/stores";
import {
  largeTitleFontFamily,
  largeTitleFontSize,
  titleFontFamily,
  useTheme,
} from "@/styles/theme";
/**
 * RootNavigator — top-level stack matching Tauri mobile App.tsx routes exactly.
 */
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { WebDavImportSource } from "@readany/core";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { TabNavigator } from "./TabNavigator";
import { NATIVE_SCROLL_EDGE_EFFECTS } from "./scroll-edge-effects";

export type RootStackParamList = {
  Tabs: undefined;
  Chat: undefined;
  Reader: {
    bookId: string;
    catalogBookId?: string;
    cfi?: string;
    highlight?: boolean;
    openTTS?: boolean;
  };
  ReaderTOC: undefined;
  BookChat: { bookId: string; selectedText?: string; chapterTitle?: string };
  NarraCharacters: { bookId: string };
  NarraCharacterChat: { bookId: string; characterId: string };
  NarraCharacterProfile: {
    bookId: string;
    characterId: string;
    /** Профиль открыт поверх уже существующего чата — кнопка «Поговорить» лишь закрывает sheet. */
    openedFromChat?: boolean;
  };
  NarraScene: {
    bookId: string;
    chapter: string;
    excerpt: string;
    sourceKey: string;
  };
  NarraSummary: {
    bookId: string;
    chapter: string;
    excerpt: string;
    sourceKey: string;
  };
  Stats: undefined;
  Badges: undefined;
  Skills: undefined;
  VectorModelSettings: undefined;
  AppearanceSettings: undefined;
  AISettings: undefined;
  TTSSettings: undefined;
  TranslationSettings: undefined;
  SyncSettings: undefined;
  About: undefined;
  FullScreenNotes: { bookId: string };
  ManualNote:
    | {
        noteId?: string;
        bookId?: string;
        cfi?: string;
        text?: string;
        chapterTitle?: string;
      }
    | undefined;
  FontSettings: undefined;
  WebDavImportBrowser: { source: WebDavImportSource };
  Storybook: undefined;
  StorybookPreview: { id: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { _hasHydrated } = useSettingsStore();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();

  if (!_hasHydrated) return null;

  return (
    <>
      <Stack.Navigator
        screenOptions={{
          headerShown: true,
          headerTransparent: Platform.OS === "ios",
          headerStyle: {
            backgroundColor: Platform.OS === "ios" ? "transparent" : colors.background,
          },
          headerShadowVisible: false,
          headerTintColor: colors.foreground,
          headerBackButtonDisplayMode: "minimal",
          headerTitleStyle: {
            color: colors.foreground,
            fontFamily: titleFontFamily,
            fontWeight: "400",
          },
          scrollEdgeEffects: NATIVE_SCROLL_EDGE_EFFECTS,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen
          name="Tabs"
          component={TabNavigator}
          options={{
            headerShown: false,
            statusBarHidden: false,
            statusBarStyle: isDark ? "light" : "dark",
          }}
        />
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={{
            presentation: "card",
            animation: "slide_from_right",
            title: "Narra AI",
            headerTransparent: false,
            headerStyle: { backgroundColor: colors.background },
          }}
        />
        <Stack.Screen
          name="Reader"
          component={ReaderScreen}
          options={{
            animation: "slide_from_right",
            animationMatchesGesture: true,
            gestureEnabled: true,
            fullScreenGestureEnabled: true,
            gestureResponseDistance: { start: 48 },
            headerShown: false,
            statusBarAnimation: "fade",
            statusBarHidden: true,
          }}
        />
        <Stack.Screen
          name="ReaderTOC"
          component={ReaderTOCSheetScreen}
          options={{
            presentation: "formSheet",
            animation: "slide_from_bottom",
            headerShown: true,
            headerBackVisible: false,
            headerTransparent: false,
            headerTitle: "Оглавление",
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.card },
            contentStyle: { backgroundColor: colors.card },
            sheetAllowedDetents: [0.55, 1],
            sheetInitialDetentIndex: 0,
            sheetGrabberVisible: true,
            sheetExpandsWhenScrolledToEdge: true,
            sheetResizeAnimationEnabled: true,
            sheetCornerRadius: 24,
          }}
        />
        <Stack.Screen
          name="BookChat"
          component={ChatScreen}
          options={{
            presentation: "card",
            animation: "slide_from_right",
            title: "Narra AI",
            headerTransparent: false,
            headerStyle: { backgroundColor: colors.background },
          }}
        />
        <Stack.Screen
          name="NarraCharacters"
          component={NarraCharactersScreen}
          options={{
            animation: "slide_from_right",
            title: t("tabs.chats", "Чаты"),
            statusBarHidden: false,
            statusBarStyle: isDark ? "light" : "dark",
            headerLargeTitleEnabled: Platform.OS === "ios",
            headerLargeTitleShadowVisible: false,
            headerLargeTitleStyle: {
              color: colors.foreground,
              fontFamily: largeTitleFontFamily,
              fontSize: largeTitleFontSize,
              fontWeight: "400",
            },
          }}
        />
        <Stack.Screen
          name="NarraCharacterChat"
          component={NarraCharacterChatScreen}
          options={{
            animation: "slide_from_right",
            title: t("narra.characterChat", "Чат с персонажем"),
            headerRight: undefined,
            scrollEdgeEffects: {
              ...NATIVE_SCROLL_EDGE_EFFECTS,
              top: "hidden",
              bottom: "hidden",
            },
            unstable_headerRightItems: () => [],
          }}
        />
        <Stack.Screen
          name="NarraCharacterProfile"
          component={NarraCharacterProfileScreen}
          options={{
            presentation: "formSheet",
            animation: "slide_from_bottom",
            headerShown: false,
            sheetAllowedDetents: [0.78, 1],
            sheetInitialDetentIndex: 0,
            sheetGrabberVisible: true,
            sheetExpandsWhenScrolledToEdge: true,
          }}
        />
        <Stack.Screen
          name="NarraScene"
          component={NarraSceneScreen}
          options={{
            animation: "slide_from_right",
            title: t("narra.scene", "Сцена"),
            headerRight: undefined,
            unstable_headerRightItems: () => [],
          }}
        />
        <Stack.Screen
          name="NarraSummary"
          component={NarraSummaryScreen}
          options={{ animation: "slide_from_right", title: t("narra.summary", "Краткий пересказ") }}
        />
        <Stack.Screen
          name="Stats"
          component={StatsScreen}
          options={{ animation: "slide_from_right", title: t("stats.title", "Статистика") }}
        />
        <Stack.Screen
          name="Badges"
          component={BadgesScreen}
          options={{
            animation: "slide_from_right",
            title: t("stats.desktop.myBadges", "Награды"),
          }}
        />
        <Stack.Screen
          name="Skills"
          component={SkillsScreen}
          options={{ animation: "slide_from_right", title: t("skills.title", "Навыки") }}
        />
        <Stack.Screen
          name="VectorModelSettings"
          component={VectorModelSettingsScreen}
          options={{
            animation: "slide_from_right",
            title: t("settings.vm_title", "Смысловой поиск"),
          }}
        />
        <Stack.Screen
          name="AppearanceSettings"
          component={AppearanceSettingsScreen}
          options={{ title: t("settings.appearance", "Оформление") }}
        />
        <Stack.Screen
          name="AISettings"
          component={AISettingsScreen}
          options={{ title: t("settings.ai_title", "ИИ") }}
        />
        <Stack.Screen
          name="TTSSettings"
          component={TTSSettingsScreen}
          options={{ title: t("settings.tts_title", "Озвучивание") }}
        />
        <Stack.Screen
          name="TranslationSettings"
          component={TranslationSettingsScreen}
          options={{ title: t("settings.translation_title", "Перевод") }}
        />
        <Stack.Screen
          name="SyncSettings"
          component={SyncSettingsScreen}
          options={{ title: t("settings.syncTitle", "Синхронизация") }}
        />
        <Stack.Screen
          name="About"
          component={AboutScreen}
          options={{ title: t("about.title", "О приложении") }}
        />
        <Stack.Screen
          name="FontSettings"
          component={FontSettingsScreen}
          options={{ animation: "slide_from_right", title: t("fonts.title", "Шрифт") }}
        />
        <Stack.Screen
          name="WebDavImportBrowser"
          component={WebDavImportBrowserScreen}
          options={{
            animation: "slide_from_right",
            title: t("library.webDavFiles", "Файлы WebDAV"),
          }}
        />
        <Stack.Screen
          name="FullScreenNotes"
          component={FullScreenNotesScreen}
          options={{ animation: "slide_from_right", title: t("notes.title", "Заметки") }}
        />
        <Stack.Screen
          name="ManualNote"
          component={ManualNoteScreen}
          options={{ animation: "slide_from_right", title: t("notes.newNote", "Новая заметка") }}
        />
        {__DEV__ ? (
          <>
            <Stack.Screen
              name="Storybook"
              component={StorybookScreen}
              options={{ title: t("common.catalog", "Каталог"), animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="StorybookPreview"
              component={StorybookPreviewScreen}
              options={({ route }) => ({
                title: getStorybookItemTitle(route.params.id),
                animation: "slide_from_right",
              })}
            />
          </>
        ) : null}
      </Stack.Navigator>
      <MissingBookPrompt />
    </>
  );
}

import { MissingBookPrompt } from "@/components/shared/MissingBookPrompt";
import BadgesScreen from "@/screens/BadgesScreen";
import { BookChatScreen } from "@/screens/BookChatScreen";
import { BookDetailsScreen } from "@/screens/BookDetailsScreen";
import { FullScreenNotesScreen } from "@/screens/FullScreenNotesScreen";
import { ReaderScreen } from "@/screens/ReaderScreen";
import SkillsScreen from "@/screens/SkillsScreen";
import StatsScreen from "@/screens/StatsScreen";
import {
  StorybookPreviewScreen,
  StorybookScreen,
  getStorybookItemTitle,
} from "@/screens/StorybookScreen";
import { WebDavImportBrowserScreen } from "@/screens/library/WebDavImportBrowserScreen";
import AISettingsScreen from "@/screens/settings/AISettingsScreen";
import AboutScreen from "@/screens/settings/AboutScreen";
import AppearanceSettingsScreen from "@/screens/settings/AppearanceSettingsScreen";
import FeedbackDetailScreen from "@/screens/settings/FeedbackDetailScreen";
import FeedbackScreen from "@/screens/settings/FeedbackScreen";
import FontSettingsScreen from "@/screens/settings/FontSettingsScreen";
import SyncSettingsScreen from "@/screens/settings/SyncSettingsScreen";
import TTSSettingsScreen from "@/screens/settings/TTSSettingsScreen";
import TranslationSettingsScreen from "@/screens/settings/TranslationSettingsScreen";
import VectorModelSettingsScreen from "@/screens/settings/VectorModelSettingsScreen";
import { useSettingsStore } from "@/stores";
import { titleFontFamily, useColors } from "@/styles/theme";
/**
 * RootNavigator — top-level stack matching Tauri mobile App.tsx routes exactly.
 */
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { WebDavImportSource } from "@readany/core";
import { useTranslation } from "react-i18next";
import { TabNavigator } from "./TabNavigator";

export type RootStackParamList = {
  Tabs: undefined;
  Reader: { bookId: string; cfi?: string; highlight?: boolean; openTTS?: boolean };
  BookDetails: { bookId: string };
  BookChat: { bookId: string; selectedText?: string; chapterTitle?: string };
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
  Feedback: undefined;
  FeedbackDetail: { issueNumber: number; title: string };
  FullScreenNotes: { bookId: string };
  FontSettings: undefined;
  WebDavImportBrowser: { source: WebDavImportSource };
  Storybook: undefined;
  StorybookPreview: { id: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { _hasHydrated } = useSettingsStore();
  const colors = useColors();
  const { t } = useTranslation();

  if (!_hasHydrated) return null;

  return (
    <>
      <Stack.Navigator
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.foreground,
          headerBackButtonDisplayMode: "minimal",
          headerTitleStyle: {
            color: colors.foreground,
            fontFamily: titleFontFamily,
            fontWeight: "600",
          },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="Tabs" component={TabNavigator} options={{ headerShown: false }} />
        <Stack.Screen
          name="Reader"
          component={ReaderScreen}
          options={{ animation: "slide_from_right", headerShown: false }}
        />
        <Stack.Screen
          name="BookDetails"
          component={BookDetailsScreen}
          options={{
            animation: "slide_from_right",
            title: t("library.detailsTitle", "О книге"),
          }}
        />
        <Stack.Screen
          name="BookChat"
          component={BookChatScreen}
          options={{ animation: "slide_from_right", title: t("chat.bookChat", "Чат о книге") }}
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
          name="Feedback"
          component={FeedbackScreen}
          options={{ title: t("feedback.title", "Обратная связь") }}
        />
        <Stack.Screen
          name="FeedbackDetail"
          component={FeedbackDetailScreen}
          options={{ animation: "slide_from_right", title: t("feedback.details", "Обращение") }}
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
        {__DEV__ ? (
          <>
            <Stack.Screen
              name="Storybook"
              component={StorybookScreen}
              options={{ title: "Каталог", animation: "slide_from_right" }}
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

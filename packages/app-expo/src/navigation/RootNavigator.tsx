import { OnboardingNavigator } from "@/components/onboarding/OnboardingNavigator";
import { MissingBookPrompt } from "@/components/shared/MissingBookPrompt";
import BadgesScreen from "@/screens/BadgesScreen";
import { BookChatScreen } from "@/screens/BookChatScreen";
import { BookDetailsScreen } from "@/screens/BookDetailsScreen";
import { FullScreenNotesScreen } from "@/screens/FullScreenNotesScreen";
import { ReaderScreen } from "@/screens/ReaderScreen";
import { NarraCharactersScreen } from "@/screens/NarraCharactersScreen";
import { NarraCharacterChatScreen } from "@/screens/NarraCharacterChatScreen";
import { NarraMomentScreen } from "@/screens/NarraMomentScreen";
import SkillsScreen from "@/screens/SkillsScreen";
import StatsScreen from "@/screens/StatsScreen";
import { WebDavImportBrowserScreen } from "@/screens/library/WebDavImportBrowserScreen";
import { useSettingsStore } from "@/stores";
/**
 * RootNavigator — top-level stack matching Tauri mobile App.tsx routes exactly.
 */
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { WebDavImportSource } from "@readany/core";
import { TabNavigator } from "./TabNavigator";

export type RootStackParamList = {
  Onboarding: undefined;
  Tabs: undefined;
  Reader: { bookId: string; cfi?: string; highlight?: boolean; openTTS?: boolean };
  BookDetails: { bookId: string };
  BookChat: { bookId: string; selectedText?: string; chapterTitle?: string };
  NarraCharacters: { bookId: string };
  NarraCharacterChat: { bookId: string; characterId: string };
  NarraMoment: { bookId: string; chapter: string; excerpt: string };
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
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { hasCompletedOnboarding, _hasHydrated } = useSettingsStore();

  const showOnboarding = !hasCompletedOnboarding && _hasHydrated;

  if (!_hasHydrated) return null;

  return (
    <>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {showOnboarding ? (
          <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
        ) : (
          <>
            <Stack.Screen name="Tabs" component={TabNavigator} />
            <Stack.Screen
              name="Reader"
              component={ReaderScreen}
              options={{ animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="BookDetails"
              component={BookDetailsScreen}
              options={{ animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="BookChat"
              component={BookChatScreen}
              options={{ animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="NarraCharacters"
              component={NarraCharactersScreen}
              options={{ animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="NarraCharacterChat"
              component={NarraCharacterChatScreen}
              options={{ animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="NarraMoment"
              component={NarraMomentScreen}
              options={{ animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="Stats"
              component={StatsScreen}
              options={{ animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="Badges"
              component={BadgesScreen}
              options={{ animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="Skills"
              component={SkillsScreen}
              options={{ animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="WebDavImportBrowser"
              component={WebDavImportBrowserScreen}
              options={{ animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="FullScreenNotes"
              component={FullScreenNotesScreen}
              options={{ animation: "slide_from_right" }}
            />
          </>
        )}
      </Stack.Navigator>
      <MissingBookPrompt />
    </>
  );
}

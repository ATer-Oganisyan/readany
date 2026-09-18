import { MissingBookPrompt } from "@/components/shared/MissingBookPrompt";
import type { CachedBackendCatalogBook } from "@/lib/narra/backend-catalog-cache";
import { ChatScreen } from "@/screens/ChatScreen";
import { FullScreenNotesScreen } from "@/screens/FullScreenNotesScreen";
import { ManualNoteScreen } from "@/screens/ManualNoteScreen";
import { NarraCharacterChatScreen } from "@/screens/NarraCharacterChatScreen";
import { NarraCharacterProfileScreen } from "@/screens/NarraCharacterProfileScreen";
import { NarraCharactersScreen } from "@/screens/NarraCharactersScreen";
import { NarraSummaryScreen } from "@/screens/NarraSummaryScreen";
import { ReaderScreen } from "@/screens/ReaderScreen";
import SkillsScreen from "@/screens/SkillsScreen";
import {
  StorybookPreviewScreen,
  StorybookScreen,
  getStorybookItemTitle,
} from "@/screens/StorybookScreen";
import { AudiobookPlayerScreen } from "@/screens/audiobook-player-screen";
import { CatalogCategoryScreen } from "@/screens/catalog-category-screen";
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
import { ElevatedSurfaceTheme, radius, titleFontFamily, useTheme } from "@/styles/theme";
/**
 * RootNavigator — top-level stack matching Tauri mobile App.tsx routes exactly.
 */
import {
  type NativeStackScreenProps,
  createNativeStackNavigator,
} from "@react-navigation/native-stack";
import type { WebDavImportSource } from "@readany/core";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import ReadAnyNativeControls from "../../modules/native-controls";
import { TabNavigator } from "./TabNavigator";
import { NATIVE_SCROLL_EDGE_EFFECTS } from "./scroll-edge-effects";

export type RootStackParamList = {
  Tabs: undefined;
  CatalogCategory: { genreId: string; title: string };
  Chat: undefined;
  Reader: {
    bookId: string;
    catalogBookId?: string;
    /** Книга из каталога бэкенда: ридер сам качает и импортирует её под своим лоудером. */
    catalogBook?: CachedBackendCatalogBook;
    cfi?: string;
    highlight?: boolean;
    openTTS?: boolean;
  };
  ReaderTOC: undefined;
  AudiobookPlayer: { sourceId?: string } | undefined;
  BookChat: { bookId: string; selectedText?: string; chapterTitle?: string };
  NarraCharacters: { bookId: string; charactersSheetSourceId?: string };
  NarraCharacterChat: { bookId: string; characterId: string; fromChatsTab?: boolean };
  NarraCharacterProfile: {
    bookId: string;
    characterId: string;
    /** Профиль открыт поверх уже существующего чата — кнопка «Поговорить» лишь закрывает sheet. */
    openedFromChat?: boolean;
  };
  NarraSummary: {
    bookId: string;
    chapter: string;
    excerpt: string;
    sourceKey: string;
  };
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

function NarraCharacterChatRouteScreen(
  props: NativeStackScreenProps<RootStackParamList, "NarraCharacterChat">,
) {
  if (Platform.OS !== "ios" || props.route.params.fromChatsTab)
    return <NarraCharacterChatScreen {...props} />;

  return (
    <ElevatedSurfaceTheme>
      <NarraCharacterChatScreen {...props} />
    </ElevatedSurfaceTheme>
  );
}

export function RootNavigator() {
  const { _hasHydrated } = useSettingsStore();
  const { colors, isDark } = useTheme();
  const readerFocused = useRef(false);
  useEffect(() => {
    if (Platform.OS === "android" && !readerFocused.current) {
      void ReadAnyNativeControls.setNavigationBarTheme?.(colors.background, isDark);
    }
  }, [colors.background, isDark]);
  const { t } = useTranslation();

  if (!_hasHydrated) return null;

  return (
    <>
      <Stack.Navigator
        screenListeners={({ route }) => ({
          focus: () => {
            readerFocused.current = route.name === "Reader";
            if (Platform.OS === "android" && !readerFocused.current) {
              void ReadAnyNativeControls.setNavigationBarTheme?.(colors.background, isDark);
            }
          },
        })}
        screenOptions={{
          ...(Platform.OS === "android"
            ? { sheetCornerRadius: radius.card, sheetAllowedDetents: [0.8] }
            : {}),
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
            fontWeight: "600",
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
          name="CatalogCategory"
          component={CatalogCategoryScreen}
          options={({ route }) => ({
            ...(Platform.OS === "ios"
              ? { title: "", headerLargeTitleEnabled: false }
              : { title: route.params.title }),
            statusBarHidden: false,
            statusBarStyle: isDark ? "light" : "dark",
          })}
        />
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={{
            presentation: "card",
            animation: "slide_from_right",
            title: "Narra",
            headerShown: false,
            statusBarHidden: false,
            statusBarStyle: isDark ? "light" : "dark",
          }}
        />
        <Stack.Screen
          name="Reader"
          component={ReaderScreen}
          options={{
            presentation: "fullScreenModal",
            animation: "slide_from_bottom",
            // Horizontal drags belong to page turning, so the reader carries no
            // back-swipe of its own: it is dismissed by the close button.
            gestureEnabled: false,
            // No native header: the Foliate reader owns its complete chrome.
            headerShown: false,
            statusBarAnimation: "fade",
            statusBarHidden: true,
          }}
        />
        <Stack.Screen
          name="ReaderTOC"
          component={ReaderTOCSheetScreen}
          options={{
            presentation: Platform.OS === "android" ? "transparentModal" : "formSheet",
            animation: Platform.OS === "android" ? "none" : "slide_from_bottom",
            contentStyle:
              Platform.OS === "android" ? { backgroundColor: "transparent" } : undefined,
            headerShown: Platform.OS !== "android",
            headerBackVisible: false,
            headerTransparent: false,
            headerTitle: t("reader.toc", "Оглавление"),
            headerShadowVisible: false,
            sheetAllowedDetents: Platform.OS === "android" ? [0.5, 0.8] : [0.5, 1],
            sheetInitialDetentIndex: 0,
            sheetGrabberVisible: true,
            sheetExpandsWhenScrolledToEdge: true,
            sheetResizeAnimationEnabled: true,
          }}
        />
        <Stack.Screen
          name="AudiobookPlayer"
          component={AudiobookPlayerScreen}
          options={{
            presentation: Platform.OS === "android" ? "transparentModal" : "formSheet",
            animation: Platform.OS === "android" ? "none" : "slide_from_bottom",
            headerShown: false,
            sheetAllowedDetents: "fitToContents",
            sheetGrabberVisible: true,
            contentStyle: {
              backgroundColor:
                Platform.OS === "ios"
                  ? isDark
                    ? colors.elevation2
                    : colors.background
                  : "transparent",
            },
            statusBarHidden: false,
            statusBarStyle: isDark ? "light" : "dark",
          }}
        />
        <Stack.Screen
          name="BookChat"
          component={ChatScreen}
          options={{
            presentation: "card",
            animation: "slide_from_right",
            title: "Narra",
            headerShown: false,
            statusBarHidden: false,
            statusBarStyle: isDark ? "light" : "dark",
          }}
        />
        <Stack.Screen
          name="NarraCharacters"
          component={NarraCharactersScreen}
          options={
            Platform.OS === "ios"
              ? {
                  presentation: "formSheet",
                  animation: "default",
                  headerShown: false,
                  statusBarHidden: false,
                  statusBarStyle: isDark ? "light" : "dark",
                  // Шторка приподнята над ридером — см. ElevatedSurfaceTheme.
                  contentStyle: {
                    backgroundColor: isDark ? colors.elevation2 : colors.background,
                  },
                  sheetAllowedDetents: [0.55, 1],
                  sheetInitialDetentIndex: 0,
                  sheetGrabberVisible: true,
                  sheetExpandsWhenScrolledToEdge: true,
                  sheetResizeAnimationEnabled: true,
                }
              : {
                  animation: "slide_from_right",
                  title: t("narra.characters", "Персонажи"),
                  statusBarHidden: false,
                  statusBarStyle: isDark ? "light" : "dark",
                }
          }
        />
        <Stack.Screen
          name="NarraCharacterChat"
          component={NarraCharacterChatRouteScreen}
          options={({ route }) => ({
            // Keep the chat above the modal reader when replacing the profile sheet.
            presentation:
              Platform.OS === "ios" && !route.params.fromChatsTab ? "formSheet" : "card",
            animation:
              Platform.OS === "ios" && !route.params.fromChatsTab
                ? "slide_from_bottom"
                : "slide_from_right",
            gestureEnabled: true,
            sheetAllowedDetents: [1],
            sheetGrabberVisible: true,
            sheetExpandsWhenScrolledToEdge: false,
            contentStyle: {
              backgroundColor:
                Platform.OS === "ios" && !route.params.fromChatsTab && isDark
                  ? colors.elevation2
                  : colors.background,
            },
            title: t("narra.characterChat", "Чат с персонажем"),
            headerShown: false,
            statusBarHidden: false,
            statusBarStyle: isDark ? "light" : "dark",
            scrollEdgeEffects: {
              ...NATIVE_SCROLL_EDGE_EFFECTS,
              top: "hidden",
              bottom: "hidden",
            },
          })}
        />
        <Stack.Screen
          name="NarraCharacterProfile"
          component={NarraCharacterProfileScreen}
          options={{
            presentation: Platform.OS === "android" ? "transparentModal" : "formSheet",
            animation: Platform.OS === "android" ? "none" : "slide_from_bottom",
            headerShown: false,
            scrollEdgeEffects: {
              ...NATIVE_SCROLL_EDGE_EFFECTS,
              top: "hidden",
            },
            contentStyle: {
              backgroundColor: "transparent",
            },
            statusBarHidden: false,
            statusBarStyle: isDark ? "light" : "dark",
            sheetAllowedDetents: [0.78, 1],
            sheetInitialDetentIndex: 0,
            sheetGrabberVisible: true,
            sheetExpandsWhenScrolledToEdge: true,
          }}
        />
        <Stack.Screen
          name="NarraSummary"
          component={NarraSummaryScreen}
          options={{ animation: "slide_from_right", title: t("narra.summary", "Краткий пересказ") }}
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
          options={({ navigation }) => ({
            title: t("notes.title", "Заметки"),
            headerLargeTitle: false,
            headerTransparent: false,
            headerStyle: { backgroundColor: colors.background },
            ...(Platform.OS === "ios"
              ? {
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [1],
                  sheetGrabberVisible: true,
                  sheetExpandsWhenScrolledToEdge: false,
                  unstable_headerLeftItems: () => [
                    {
                      type: "button" as const,
                      label: t("common.close", "Закрыть"),
                      accessibilityLabel: t("common.close", "Закрыть"),
                      icon: { type: "sfSymbol" as const, name: "xmark" },
                      onPress: () => navigation.goBack(),
                    },
                  ],
                }
              : { animation: "slide_from_right" }),
          })}
        />
        <Stack.Screen
          name="ManualNote"
          component={ManualNoteScreen}
          options={{
            title: t("notes.newNote", "Новая заметка"),
            ...(Platform.OS === "ios"
              ? {
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [1],
                  sheetGrabberVisible: true,
                  sheetExpandsWhenScrolledToEdge: false,
                }
              : { animation: "slide_from_right" }),
          }}
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

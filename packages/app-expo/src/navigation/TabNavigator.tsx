import { NativeButton } from "@/components/ui/NativeButton";
import { SyncButton } from "@/components/ui/SyncButton";
import { ChatsScreen } from "@/screens/ChatsScreen";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { NotesScreen } from "@/screens/NotesScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { SearchScreen } from "@/screens/SearchScreen";
import { useTheme } from "@/styles/ThemeContext";
import {
  fontFamily,
  largeTitleFontFamily,
  largeTitleFontSize,
  titleFontFamily,
} from "@/styles/theme";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import {
  type NativeBottomTabIcon,
  createNativeBottomTabNavigator,
} from "@react-navigation/bottom-tabs/unstable";
import type { NavigatorScreenParams } from "@react-navigation/native";
import {
  type NativeStackNavigationOptions,
  createNativeStackNavigator,
} from "@react-navigation/native-stack";
import { useSyncStore } from "@readany/core/stores";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ImageSourcePropType, Platform } from "react-native";
import { NATIVE_SCROLL_EDGE_EFFECTS } from "./scroll-edge-effects";

export type LibraryTabStackParamList = {
  LibraryHome: { initialSection?: "catalog" | "my-books" } | undefined;
};
export type TabParamList = {
  Library: NavigatorScreenParams<LibraryTabStackParamList> | undefined;
  Chats: undefined;
  Profile: undefined;
  Search: undefined;
};
export type ChatsTabStackParamList = { ChatsHome: undefined };
export type SearchTabStackParamList = { SearchHome: undefined };
export type ProfileTabStackParamList = {
  ProfileHome: undefined;
  ProfileNotes: { bookId?: string } | undefined;
};

const Tab = createNativeBottomTabNavigator<TabParamList>();
const LibraryStack = createNativeStackNavigator<LibraryTabStackParamList>();
const ChatsStack = createNativeStackNavigator<ChatsTabStackParamList>();
const SearchStack = createNativeStackNavigator<SearchTabStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileTabStackParamList>();

type AndroidTabIcons = Record<keyof TabParamList, ImageSourcePropType>;

function useAndroidMaterialTabIcons() {
  const [icons, setIcons] = useState<AndroidTabIcons | null | undefined>(
    Platform.OS === "android" ? undefined : null,
  );

  useEffect(() => {
    if (Platform.OS !== "android") return;

    let cancelled = false;
    void Promise.all([
      MaterialIcons.getImageSource("local-library", 24, "#000000"),
      MaterialIcons.getImageSource("chat", 24, "#000000"),
      MaterialIcons.getImageSource("person", 24, "#000000"),
      MaterialIcons.getImageSource("search", 24, "#000000"),
    ])
      .then(([library, chats, profile, search]) => {
        if (cancelled) return;
        if (!library || !chats || !profile || !search) {
          setIcons(null);
          return;
        }
        setIcons({ Library: library, Chats: chats, Profile: profile, Search: search });
      })
      .catch((error) => {
        console.error("[TabNavigator] Failed to render Material tab icons", error);
        if (!cancelled) setIcons(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return icons;
}

function tabIcon(
  sfSymbol: Extract<NativeBottomTabIcon, { type: "sfSymbol" }>["name"],
  androidSource: ImageSourcePropType | null | undefined,
): NativeBottomTabIcon | undefined {
  return Platform.OS === "ios"
    ? { type: "sfSymbol", name: sfSymbol }
    : androidSource
      ? { type: "image", source: androidSource }
      : undefined;
}

function useTabStackScreenOptions(): NativeStackNavigationOptions {
  const { colors, isDark } = useTheme();

  return {
    headerShown: true,
    statusBarHidden: false,
    statusBarStyle: isDark ? "light" : "dark",
    headerTransparent: Platform.OS === "ios",
    headerStyle: {
      backgroundColor: Platform.OS === "ios" ? "transparent" : colors.background,
    },
    headerShadowVisible: false,
    headerTintColor: colors.foreground,
    headerTitleStyle: {
      color: colors.foreground,
      fontFamily: titleFontFamily,
      fontWeight: "400",
    },
    scrollEdgeEffects: NATIVE_SCROLL_EDGE_EFFECTS,
    contentStyle: { backgroundColor: colors.background },
  };
}

/** iOS large-title options shared by the tab stack home screens. */
function useLargeTitleOptions(): NativeStackNavigationOptions {
  const { colors } = useTheme();

  return Platform.OS === "ios"
    ? {
        headerLargeTitleEnabled: true,
        headerLargeTitleShadowVisible: false,
        headerLargeTitleStyle: {
          color: colors.foreground,
          fontFamily: largeTitleFontFamily,
          fontSize: largeTitleFontSize,
          fontWeight: "400",
        },
      }
    : {};
}

function LibraryTabStackNavigator() {
  const { t } = useTranslation();
  const screenOptions = useTabStackScreenOptions();
  const largeTitleOptions = useLargeTitleOptions();

  return (
    <LibraryStack.Navigator screenOptions={screenOptions}>
      <LibraryStack.Screen
        name="LibraryHome"
        component={LibraryScreen}
        options={{
          title: t("tabs.library", "Библиотека"),
          ...largeTitleOptions,
        }}
      />
    </LibraryStack.Navigator>
  );
}

function ChatsTabStackNavigator() {
  const { t } = useTranslation();
  const screenOptions = useTabStackScreenOptions();
  const largeTitleOptions = useLargeTitleOptions();

  return (
    <ChatsStack.Navigator screenOptions={screenOptions}>
      <ChatsStack.Screen
        name="ChatsHome"
        component={ChatsScreen}
        options={{
          title: t("tabs.chats", "Чаты"),
          ...largeTitleOptions,
        }}
      />
    </ChatsStack.Navigator>
  );
}

function SearchTabStackNavigator() {
  const screenOptions = useTabStackScreenOptions();

  return (
    <SearchStack.Navigator screenOptions={screenOptions}>
      <SearchStack.Screen
        name="SearchHome"
        component={SearchScreen}
        options={{
          title: "",
          headerTitle: "",
          headerLargeTitleEnabled: false,
        }}
      />
    </SearchStack.Navigator>
  );
}

function ProfileTabStackNavigator() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const screenOptions = useTabStackScreenOptions();
  const largeTitleOptions = useLargeTitleOptions();
  const syncNow = useSyncStore((state) => state.syncNow);
  const syncStatus = useSyncStore((state) => state.status);
  const syncBackendType = useSyncStore((state) => state.backendType);
  const loadSyncConfig = useSyncStore((state) => state.loadConfig);
  const isSyncBusy = syncStatus !== "idle" && syncStatus !== "error";

  useEffect(() => {
    if (!syncBackendType) void loadSyncConfig();
  }, [loadSyncConfig, syncBackendType]);

  const handleSync = useCallback(() => {
    if (!isSyncBusy) void syncNow();
  }, [isSyncBusy, syncNow]);

  return (
    <ProfileStack.Navigator screenOptions={screenOptions}>
      <ProfileStack.Screen
        name="ProfileHome"
        component={ProfileScreen}
        options={{
          title: t("tabs.profile", "Профиль"),
          ...largeTitleOptions,
          ...(Platform.OS === "ios"
            ? {
                unstable_headerRightItems: () =>
                  syncBackendType
                    ? [
                        {
                          type: "button" as const,
                          label: t("common.sync", "Синхронизировать"),
                          accessibilityLabel: t("common.sync", "Синхронизировать"),
                          icon: {
                            type: "sfSymbol" as const,
                            name: "arrow.clockwise" as const,
                          },
                          disabled: isSyncBusy,
                          onPress: handleSync,
                        },
                      ]
                    : [],
              }
            : {
                headerRight: () => <SyncButton size={20} color={colors.mutedForeground} />,
              }),
        }}
      />
      <ProfileStack.Screen
        name="ProfileNotes"
        component={NotesScreen}
        options={({ navigation }) => ({
          title: t("tabs.notes", "Заметки"),
          ...(Platform.OS === "ios"
            ? {
                unstable_headerRightItems: () => [
                  {
                    type: "button" as const,
                    label: t("notes.addNote", "Добавить заметку"),
                    accessibilityLabel: t("notes.addNote", "Добавить заметку"),
                    icon: { type: "sfSymbol" as const, name: "plus" as const },
                    onPress: () =>
                      navigation
                        .getParent()
                        ?.getParent()
                        ?.navigate("ManualNote" as never),
                  },
                ],
              }
            : {
                headerRight: () => (
                  <NativeButton
                    label={t("common.add", "Добавить")}
                    accessibilityLabel={t("notes.addNote", "Добавить заметку")}
                    icon="add"
                    size="small"
                    variant="tertiary"
                    onPress={() =>
                      navigation
                        .getParent()
                        ?.getParent()
                        ?.navigate("ManualNote" as never)
                    }
                  />
                ),
              }),
        })}
      />
    </ProfileStack.Navigator>
  );
}

export function TabNavigator() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const androidTabIcons = useAndroidMaterialTabIcons();

  if (Platform.OS === "android" && androidTabIcons === undefined) return null;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelVisibilityMode: "unlabeled",
        tabBarLabelStyle: { fontFamily: fontFamily.regular },
        tabBarStyle: Platform.OS === "ios" ? undefined : { backgroundColor: colors.background },
        tabBarBlurEffect: "systemDefault",
        tabBarControllerMode: "auto",
        tabBarMinimizeBehavior: "none",
      }}
    >
      <Tab.Screen
        name="Library"
        component={LibraryTabStackNavigator}
        options={{
          title: t("tabs.library", "Библиотека"),
          tabBarLabel: Platform.OS === "ios" ? "" : t("tabs.library", "Библиотека"),
          tabBarIcon: tabIcon("book.closed.fill", androidTabIcons?.Library),
        }}
      />
      <Tab.Screen
        name="Chats"
        component={ChatsTabStackNavigator}
        options={{
          title: t("tabs.chats", "Чаты"),
          tabBarLabel: Platform.OS === "ios" ? "" : t("tabs.chats", "Чаты"),
          tabBarIcon: tabIcon("message.fill", androidTabIcons?.Chats),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileTabStackNavigator}
        options={{
          title: t("tabs.profile", "Профиль"),
          tabBarLabel: Platform.OS === "ios" ? "" : t("tabs.profile", "Профиль"),
          tabBarIcon: tabIcon("person.crop.circle.fill", androidTabIcons?.Profile),
          tabBarMinimizeBehavior: "none",
        }}
      />
      <Tab.Screen
        name="Search"
        component={SearchTabStackNavigator}
        options={{
          title: t("tabs.search", "Поиск"),
          tabBarSystemItem: Platform.OS === "ios" ? "search" : undefined,
          tabBarLabel: Platform.OS === "ios" ? "" : t("tabs.search", "Поиск"),
          tabBarIcon:
            Platform.OS === "ios" ? undefined : tabIcon("magnifyingglass", androidTabIcons?.Search),
          tabBarMinimizeBehavior: "none",
        }}
      />
    </Tab.Navigator>
  );
}

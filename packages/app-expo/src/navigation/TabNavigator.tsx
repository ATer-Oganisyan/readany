import { NativeButton } from "@/components/ui/NativeButton";
import { SyncButton } from "@/components/ui/SyncButton";
import { ChatScreen } from "@/screens/ChatScreen";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { NotesScreen } from "@/screens/NotesScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { useTheme } from "@/styles/ThemeContext";
import { fontFamily, titleFontFamily } from "@/styles/theme";
import {
  type NativeBottomTabIcon,
  createNativeBottomTabNavigator,
} from "@react-navigation/bottom-tabs/unstable";
import { useSyncStore } from "@readany/core/stores";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";

export type TabParamList = {
  Library: undefined;
  Chat: undefined;
  Notes: { bookId?: string } | undefined;
  Profile: undefined;
};

const Tab = createNativeBottomTabNavigator<TabParamList>();

const ANDROID_ICONS = {
  Library: require("../../assets/book.png"),
  Chat: require("../../assets/think.png"),
  Notes: require("../../assets/note.png"),
  Profile: require("../../assets/icon.png"),
} as const;

function tabIcon(
  sfSymbol: Extract<NativeBottomTabIcon, { type: "sfSymbol" }>["name"],
  androidSource: number,
): NativeBottomTabIcon {
  return Platform.OS === "ios"
    ? { type: "sfSymbol", name: sfSymbol }
    : { type: "image", source: androidSource };
}

export function TabNavigator() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const syncNow = useSyncStore((state) => state.syncNow);
  const syncStatus = useSyncStore((state) => state.status);
  const syncBackendType = useSyncStore((state) => state.backendType);
  const loadSyncConfig = useSyncStore((state) => state.loadConfig);
  const isSyncBusy = syncStatus !== "idle" && syncStatus !== "error";

  useEffect(() => {
    if (!syncBackendType) {
      void loadSyncConfig();
    }
  }, [loadSyncConfig, syncBackendType]);

  const handleSync = useCallback(() => {
    if (!isSyncBusy) {
      void syncNow();
    }
  }, [isSyncBusy, syncNow]);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTintColor: colors.foreground,
        headerTitleStyle: {
          color: colors.foreground,
          fontFamily: titleFontFamily,
          fontWeight: "600",
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: { fontFamily: fontFamily.regular },
        tabBarStyle: { backgroundColor: colors.background },
        tabBarBlurEffect: "systemDefault",
        tabBarControllerMode: "auto",
        tabBarMinimizeBehavior: "onScrollDown",
      }}
    >
      <Tab.Screen
        name="Library"
        component={LibraryScreen}
        options={({ navigation }) => ({
          title: t("tabs.library", "Библиотека"),
          tabBarLabel: t("tabs.library", "Библиотека"),
          tabBarIcon: tabIcon("book.closed.fill", ANDROID_ICONS.Library),
          ...(Platform.OS === "ios"
            ? {
                headerLargeTitleEnabled: true,
                headerLargeTitleShadowVisible: false,
                headerLargeTitleStyle: {
                  color: colors.foreground,
                  fontFamily: titleFontFamily,
                },
                unstable_headerLeftItems: () => [
                  {
                    type: "button" as const,
                    label: "Компоненты",
                    accessibilityLabel: "Открыть каталог компонентов",
                    icon: { type: "sfSymbol" as const, name: "square.grid.2x2" as const },
                    onPress: () => navigation.getParent()?.navigate("Storybook" as never),
                  },
                ],
              }
            : {
                headerLeft: () => (
                  <NativeButton
                    label="Компоненты"
                    accessibilityLabel="Открыть каталог компонентов"
                    icon="components"
                    size="small"
                    variant="tertiary"
                    onPress={() => navigation.getParent()?.navigate("Storybook" as never)}
                  />
                ),
              }),
        })}
      />
      {Platform.OS !== "ios" ? (
        <Tab.Screen
          name="Chat"
          component={ChatScreen}
          options={{
            title: t("tabs.ai", "ИИ"),
            tabBarLabel: t("tabs.ai", "ИИ"),
            tabBarIcon: tabIcon("message", ANDROID_ICONS.Chat),
          }}
        />
      ) : null}
      <Tab.Screen
        name="Notes"
        component={NotesScreen}
        options={({ navigation }) => ({
          title: t("tabs.notes", "Заметки"),
          tabBarLabel: t("tabs.notes", "Заметки"),
          tabBarIcon: tabIcon("highlighter", ANDROID_ICONS.Notes),
          ...(Platform.OS === "ios"
            ? {
                headerLargeTitleEnabled: true,
                headerLargeTitleShadowVisible: false,
                headerLargeTitleStyle: {
                  color: colors.foreground,
                  fontFamily: titleFontFamily,
                },
                unstable_headerRightItems: () => [
                  {
                    type: "button" as const,
                    label: "Добавить заметку",
                    accessibilityLabel: "Добавить заметку",
                    icon: { type: "sfSymbol" as const, name: "plus" as const },
                    onPress: () => navigation.getParent()?.navigate("ManualNote" as never),
                  },
                ],
              }
            : {
                headerRight: () => (
                  <NativeButton
                    label="Добавить"
                    accessibilityLabel="Добавить заметку"
                    icon="add"
                    size="small"
                    variant="tertiary"
                    onPress={() => navigation.getParent()?.navigate("ManualNote" as never)}
                  />
                ),
              }),
        })}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: t("tabs.profile", "Профиль"),
          tabBarLabel: t("tabs.profile", "Профиль"),
          tabBarIcon: tabIcon("person.crop.circle", ANDROID_ICONS.Profile),
          tabBarMinimizeBehavior: "none",
          ...(Platform.OS === "ios"
            ? {
                headerTransparent: true,
                headerStyle: { backgroundColor: "transparent" },
                unstable_headerRightItems: () =>
                  syncBackendType
                    ? [
                        {
                          type: "button" as const,
                          label: "Синхронизировать",
                          accessibilityLabel: "Синхронизировать",
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
      {Platform.OS === "ios" ? (
        <Tab.Screen
          name="Chat"
          component={ChatScreen}
          options={{
            title: t("tabs.ai", "ИИ"),
            tabBarLabel: t("tabs.ai", "ИИ"),
            tabBarIcon: tabIcon("message", ANDROID_ICONS.Chat),
          }}
        />
      ) : null}
    </Tab.Navigator>
  );
}

import { MessageSquareIcon } from "@/components/ui/Icon";
import { NativeButton } from "@/components/ui/NativeButton";
import { SyncButton } from "@/components/ui/SyncButton";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { NotesScreen } from "@/screens/NotesScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { useTheme } from "@/styles/ThemeContext";
import { fontFamily, titleFontFamily } from "@/styles/theme";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import {
  type NativeBottomTabIcon,
  createNativeBottomTabNavigator,
} from "@react-navigation/bottom-tabs/unstable";
import { useSyncStore } from "@readany/core/stores";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ImageSourcePropType, Platform, StyleSheet, TouchableOpacity } from "react-native";

export type TabParamList = {
  Library: undefined;
  Notes: { bookId?: string } | undefined;
  Profile: undefined;
};

const Tab = createNativeBottomTabNavigator<TabParamList>();

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
      MaterialIcons.getImageSource("edit-note", 24, "#000000"),
      MaterialIcons.getImageSource("person", 24, "#000000"),
    ])
      .then(([library, notes, profile]) => {
        if (cancelled) return;
        if (!library || !notes || !profile) {
          setIcons(null);
          return;
        }
        setIcons({ Library: library, Notes: notes, Profile: profile });
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

export function TabNavigator() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const syncNow = useSyncStore((state) => state.syncNow);
  const syncStatus = useSyncStore((state) => state.status);
  const syncBackendType = useSyncStore((state) => state.backendType);
  const loadSyncConfig = useSyncStore((state) => state.loadConfig);
  const isSyncBusy = syncStatus !== "idle" && syncStatus !== "error";
  const androidTabIcons = useAndroidMaterialTabIcons();

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

  if (Platform.OS === "android" && androidTabIcons === undefined) return null;

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
          tabBarIcon: tabIcon("book.closed.fill", androidTabIcons?.Library),
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
                    label: "Narra AI",
                    accessibilityLabel: "Открыть Narra AI",
                    icon: { type: "sfSymbol" as const, name: "message" as const },
                    onPress: () => navigation.getParent()?.navigate("Chat" as never),
                  },
                ],
              }
            : {
                headerLeft: () => (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Открыть Narra AI"
                    style={styles.headerIconButton}
                    onPress={() => navigation.getParent()?.navigate("Chat" as never)}
                    activeOpacity={0.65}
                  >
                    <MessageSquareIcon size={22} color={colors.primary} />
                  </TouchableOpacity>
                ),
              }),
        })}
      />
      <Tab.Screen
        name="Notes"
        component={NotesScreen}
        options={({ navigation }) => ({
          title: t("tabs.notes", "Заметки"),
          tabBarLabel: t("tabs.notes", "Заметки"),
          tabBarIcon: tabIcon("highlighter", androidTabIcons?.Notes),
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
          tabBarIcon: tabIcon("person.crop.circle", androidTabIcons?.Profile),
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
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  headerIconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});

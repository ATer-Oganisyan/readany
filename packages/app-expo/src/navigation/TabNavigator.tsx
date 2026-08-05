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
  type NativeBottomTabScreenProps,
  createNativeBottomTabNavigator,
} from "@react-navigation/bottom-tabs/unstable";
import {
  type NativeStackNavigationOptions,
  createNativeStackNavigator,
} from "@react-navigation/native-stack";
import { useSyncStore } from "@readany/core/stores";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ImageSourcePropType, Platform, StyleSheet, TouchableOpacity } from "react-native";

export type TabParamList = {
  Library: undefined;
  Notes: { bookId?: string } | undefined;
  Profile: undefined;
};

export type LibraryTabStackParamList = { LibraryHome: undefined };
export type NotesTabStackParamList = { NotesHome: { bookId?: string } | undefined };
export type ProfileTabStackParamList = { ProfileHome: undefined };

const Tab = createNativeBottomTabNavigator<TabParamList>();
const LibraryStack = createNativeStackNavigator<LibraryTabStackParamList>();
const NotesStack = createNativeStackNavigator<NotesTabStackParamList>();
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

function useTabStackScreenOptions(): NativeStackNavigationOptions {
  const { colors } = useTheme();

  return {
    headerShown: true,
    headerTransparent: Platform.OS === "ios",
    headerStyle: {
      backgroundColor: Platform.OS === "ios" ? "transparent" : colors.background,
    },
    headerShadowVisible: false,
    headerTintColor: colors.foreground,
    headerTitleStyle: {
      color: colors.foreground,
      fontFamily: titleFontFamily,
      fontWeight: "600",
    },
    contentStyle: { backgroundColor: colors.background },
  };
}

function LibraryTabStackNavigator() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const screenOptions = useTabStackScreenOptions();

  return (
    <LibraryStack.Navigator screenOptions={screenOptions}>
      <LibraryStack.Screen
        name="LibraryHome"
        component={LibraryScreen}
        options={({ navigation }) => ({
          title: t("tabs.library", "Библиотека"),
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
                    onPress: () =>
                      navigation
                        .getParent()
                        ?.getParent()
                        ?.navigate("Chat" as never),
                  },
                ],
              }
            : {
                headerLeft: () => (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Открыть Narra AI"
                    style={styles.headerIconButton}
                    onPress={() =>
                      navigation
                        .getParent()
                        ?.getParent()
                        ?.navigate("Chat" as never)
                    }
                    activeOpacity={0.65}
                  >
                    <MessageSquareIcon size={22} color={colors.primary} />
                  </TouchableOpacity>
                ),
              }),
        })}
      />
    </LibraryStack.Navigator>
  );
}

function NotesTabStackNavigator({ route }: NativeBottomTabScreenProps<TabParamList, "Notes">) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const screenOptions = useTabStackScreenOptions();

  return (
    <NotesStack.Navigator screenOptions={screenOptions}>
      <NotesStack.Screen
        name="NotesHome"
        component={NotesScreen}
        initialParams={route.params}
        options={({ navigation }) => ({
          title: t("tabs.notes", "Заметки"),
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
                    label="Добавить"
                    accessibilityLabel="Добавить заметку"
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
    </NotesStack.Navigator>
  );
}

function ProfileTabStackNavigator() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const screenOptions = useTabStackScreenOptions();
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
          ...(Platform.OS === "ios"
            ? {
                headerLargeTitleEnabled: true,
                headerLargeTitleShadowVisible: false,
                headerLargeTitleStyle: {
                  color: colors.foreground,
                  fontFamily: titleFontFamily,
                },
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
        tabBarLabelStyle: { fontFamily: fontFamily.regular },
        tabBarStyle: Platform.OS === "ios" ? undefined : { backgroundColor: colors.background },
        tabBarBlurEffect: "systemDefault",
        tabBarControllerMode: "auto",
        tabBarMinimizeBehavior: "onScrollDown",
      }}
    >
      <Tab.Screen
        name="Library"
        component={LibraryTabStackNavigator}
        options={{
          title: t("tabs.library", "Библиотека"),
          tabBarLabel: t("tabs.library", "Библиотека"),
          tabBarIcon: tabIcon("book.closed.fill", androidTabIcons?.Library),
        }}
      />
      <Tab.Screen
        name="Notes"
        component={NotesTabStackNavigator}
        options={{
          title: t("tabs.notes", "Заметки"),
          tabBarLabel: t("tabs.notes", "Заметки"),
          tabBarIcon: tabIcon("highlighter", androidTabIcons?.Notes),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileTabStackNavigator}
        options={{
          title: t("tabs.profile", "Профиль"),
          tabBarLabel: t("tabs.profile", "Профиль"),
          tabBarIcon: tabIcon("person.crop.circle", androidTabIcons?.Profile),
          tabBarMinimizeBehavior: "none",
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

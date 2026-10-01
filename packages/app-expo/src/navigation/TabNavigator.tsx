import { AudiobookPlayerAccessory } from "@/components/tts/audiobook-player-accessory";
import { getFilledIconImageSource, getStrokeIconImageSource } from "@/components/ui/MishanaerIcon";
import { NativeButton } from "@/components/ui/NativeButton";
import { AUDIOBOOK_PLAYER_ENABLED } from "@/lib/audiobook-player";
import { BookmarksScreen } from "@/screens/BookmarksScreen";
import { ChatsScreen } from "@/screens/ChatsScreen";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { NotesScreen } from "@/screens/NotesScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { SearchScreen } from "@/screens/SearchScreen";
import { useTTSStore } from "@/stores/tts-store";
import { useTheme } from "@/styles/ThemeContext";
import {
  fontFamily,
  largeTitleFontFamily,
  largeTitleFontSize,
  titleFontFamily,
} from "@/styles/theme";
import {
  type NativeBottomTabIcon,
  createNativeBottomTabNavigator,
} from "@react-navigation/bottom-tabs/unstable";
import type { NavigatorScreenParams } from "@react-navigation/native";
import {
  type NativeStackNavigationOptions,
  createNativeStackNavigator,
} from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";
import { SafeAreaView } from "react-native-screens/experimental";
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
  ProfileBookmarks: undefined;
};

const Tab = createNativeBottomTabNavigator<TabParamList>();
const LibraryStack = createNativeStackNavigator<LibraryTabStackParamList>();
const ChatsStack = createNativeStackNavigator<ChatsTabStackParamList>();
const SearchStack = createNativeStackNavigator<SearchTabStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileTabStackParamList>();

// Android native tabs overlay their content. Reserve the measured native bar
// height before laying out the nested stacks, including their scroll views.
const TabContent = Platform.OS === "android" ? SafeAreaView : View;
const tabContentInsets =
  Platform.OS === "android" ? { edges: { bottom: true }, insetType: "interface" as const } : {};

const TAB_ICONS = {
  Library: getFilledIconImageSource("book"),
  // Source: sboo-create/zoobr, mobile-kirilltarelkin, assets/figma/6ff29.png.
  Chats: require("../../assets/icons/zoobr/chat.png"),
  Profile: getFilledIconImageSource("person"),
  Search: getStrokeIconImageSource("magnifying-glass"),
} as const;

function tabIcon(source: (typeof TAB_ICONS)[keyof typeof TAB_ICONS]): NativeBottomTabIcon {
  return { type: "image", source };
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
      fontWeight: "600",
    },
    scrollEdgeEffects: NATIVE_SCROLL_EDGE_EFFECTS,
    contentStyle: { backgroundColor: colors.background },
  };
}

/** iOS large-title options shared by the tab stack home screens. */
export function useLargeTitleOptions(): NativeStackNavigationOptions {
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
  const screenOptions = useTabStackScreenOptions();
  const largeTitleOptions = useLargeTitleOptions();
  return (
    <ProfileStack.Navigator screenOptions={screenOptions}>
      <ProfileStack.Screen
        name="ProfileHome"
        component={ProfileScreen}
        options={{
          title: t("tabs.profile", "Профиль"),
          ...largeTitleOptions,
        }}
      />
      <ProfileStack.Screen
        name="ProfileNotes"
        component={NotesScreen}
        options={({ navigation }) => ({
          title: t("tabs.notes", "Заметки"),
          headerBackButtonDisplayMode: "minimal",
          ...(Platform.OS === "ios"
            ? {
                unstable_headerRightItems: () => [
                  {
                    type: "button" as const,
                    label: t("notes.addNote", "Добавить заметку"),
                    accessibilityLabel: t("notes.addNote", "Добавить заметку"),
                    icon: {
                      type: "image" as const,
                      source: getStrokeIconImageSource("plus"),
                    },
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
                    iconOnly
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
      <ProfileStack.Screen
        name="ProfileBookmarks"
        component={BookmarksScreen}
        options={{
          title: t("bookmarks.title", "Закладки"),
          headerBackButtonDisplayMode: "minimal",
        }}
      />
    </ProfileStack.Navigator>
  );
}

export function TabNavigator() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const hasPlayer = useTTSStore(
    (state) =>
      AUDIOBOOK_PLAYER_ENABLED && state.playState !== "stopped" && Boolean(state.currentBookId),
  );
  const nativeAccessory =
    Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26;

  return (
    <Tab.Navigator
      screenLayout={
        nativeAccessory
          ? undefined
          : ({ children }) => (
              <TabContent {...tabContentInsets} style={{ flex: 1 }}>
                <View style={{ flex: 1 }}>{children}</View>
                {hasPlayer && (
                  <SafeAreaView
                    edges={{ bottom: Platform.OS === "ios", top: false, left: true, right: true }}
                    style={{
                      flex: 0,
                      backgroundColor: Platform.OS === "android" ? colors.background : colors.card,
                    }}
                  >
                    <View style={{ height: 60 }}>
                      <AudiobookPlayerAccessory />
                    </View>
                  </SafeAreaView>
                )}
              </TabContent>
            )
      }
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.primary80,
        tabBarLabelVisibilityMode: "unlabeled",
        tabBarLabelStyle: { fontFamily: fontFamily.regular },
        tabBarStyle: Platform.OS === "ios" ? undefined : { backgroundColor: colors.background },
        tabBarBlurEffect: "systemDefault",
        tabBarControllerMode: "auto",
        tabBarMinimizeBehavior:
          hasPlayer && nativeAccessory && route.name !== "Search" ? "onScrollDown" : "none",
        bottomAccessory:
          hasPlayer && nativeAccessory && route.name !== "Search"
            ? ({ placement }) => <AudiobookPlayerAccessory placement={placement} />
            : undefined,
      })}
    >
      <Tab.Screen
        name="Library"
        component={LibraryTabStackNavigator}
        options={{
          title: t("tabs.library", "Библиотека"),
          tabBarLabel: "",
          tabBarIcon: tabIcon(TAB_ICONS.Library),
        }}
      />
      <Tab.Screen
        name="Chats"
        component={ChatsTabStackNavigator}
        options={{
          title: t("tabs.chats", "Чаты"),
          tabBarLabel: "",
          tabBarIcon: tabIcon(TAB_ICONS.Chats),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileTabStackNavigator}
        options={{
          title: t("tabs.profile", "Профиль"),
          tabBarLabel: "",
          tabBarIcon: tabIcon(TAB_ICONS.Profile),
        }}
      />
      <Tab.Screen
        name="Search"
        component={SearchTabStackNavigator}
        options={{
          title: t("tabs.search", "Поиск"),
          // iOS renders the search destination as a separate trailing control.
          tabBarSystemItem: Platform.OS === "ios" ? "search" : undefined,
          tabBarLabel: "",
          tabBarIcon: tabIcon(TAB_ICONS.Search),
        }}
      />
    </Tab.Navigator>
  );
}

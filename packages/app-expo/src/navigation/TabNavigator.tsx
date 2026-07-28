import { BookOpenIcon, LibraryIcon, UserIcon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { useLibraryStore } from "@/stores";
import { useTheme } from "@/styles/ThemeContext";
/**
 * TabNavigator — bottom tab bar matching the Tauri mobile app's 4 tabs.
 * Icons: BookOpen, MessageSquare, NotebookPen, User (matching BottomTabBar.tsx)
 */
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NavigationProp } from "@react-navigation/native";
import { useCallback } from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootStackParamList } from "./RootNavigator";

export type TabParamList = {
  Library: undefined;
  ReaderHome: undefined;
  Journey: undefined;
  // Legacy contextual screens remain typed for existing deep links,
  // but are no longer top-level Narra tabs.
  Chat: undefined;
  Notes: { bookId?: string } | undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

function ReaderHomeScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const books = useLibraryStore((state) => state.books);

  useFocusEffect(
    useCallback(() => {
      const recent = [...books]
        .filter((book) => !book.deletedAt)
        .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))[0];
      if (recent) {
        navigation.navigate("Reader", {
          bookId: recent.id,
          cfi: recent.currentCfi,
        });
      }
    }, [books, navigation]),
  );

  // When the library is empty, this doubles as the useful empty state/import screen.
  return <LibraryScreen />;
}

function JourneyScreen() {
  return <ProfileScreen section="journey" />;
}

export function TabNavigator() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();

  const androidNavigationFallback =
    Platform.OS === "android" ? (insets.bottom > 0 ? 28 : layout.isTablet ? 32 : 40) : 0;

  // Some Android devices under-report or completely miss the bottom inset when
  // classic three-button navigation is enabled, so we keep a larger fallback
  // reserve in that case to stop the system bar from covering the tab bar.
  const bottomInset =
    Platform.OS === "android" ? Math.max(insets.bottom, androidNavigationFallback) : insets.bottom;

  const baseTabBarHeight = layout.isTabletLandscape ? 72 : layout.isTablet ? 76 : 60;
  const tabBarHeight = baseTabBarHeight + bottomInset;

  return (
    <Tab.Navigator
      safeAreaInsets={{ ...insets, bottom: bottomInset }}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: {
          fontSize: layout.isTablet ? 13 : 12,
          fontWeight: "500",
          marginBottom: layout.isTabletLandscape ? 2 : 0,
        },
        tabBarItemStyle: layout.isTabletLandscape ? { paddingHorizontal: 10 } : undefined,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
          paddingTop: layout.isTabletLandscape ? 8 : 4,
          paddingBottom: bottomInset,
          height: tabBarHeight,
        },
        sceneStyle: {
          paddingBottom: Platform.OS === "android" && insets.bottom === 0 ? 4 : 0,
        },
      }}
    >
      <Tab.Screen
        name="Library"
        component={LibraryScreen}
        options={{
          tabBarLabel: "Библиотека",
          tabBarIcon: ({ color, size }) => <LibraryIcon color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="ReaderHome"
        component={ReaderHomeScreen}
        options={{
          tabBarLabel: "Читалка",
          tabBarIcon: ({ color, size }) => <BookOpenIcon color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Journey"
        component={JourneyScreen}
        options={{
          tabBarLabel: "Мой путь",
          tabBarIcon: ({ color, size }) => <UserIcon color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}

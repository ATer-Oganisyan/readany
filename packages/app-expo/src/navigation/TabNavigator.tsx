import { BookOpenIcon, LibraryIcon, UserIcon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { useLibraryStore } from "@/stores";
import { useTheme } from "@/styles/ThemeContext";
import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
/**
 * TabNavigator — bottom tab bar matching the Tauri mobile app's 4 tabs.
 * Icons: BookOpen, MessageSquare, NotebookPen, User (matching BottomTabBar.tsx)
 */
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import type { NavigationProp } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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

function ReaderBookOption({
  book,
  selected,
  onPress,
}: {
  book: Book;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const [coverUri, setCoverUri] = useState<string>();

  useEffect(() => {
    let active = true;
    const raw = book.meta.coverUrl;
    if (!raw) {
      setCoverUri(undefined);
      return () => {
        active = false;
      };
    }
    if (/^(https?:|blob:|file:)/i.test(raw)) {
      setCoverUri(raw);
      return () => {
        active = false;
      };
    }
    void (async () => {
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const resolved = await platform.joinPath(appData, raw);
        if (active) setCoverUri(resolved);
      } catch {
        if (active) setCoverUri(undefined);
      }
    })();
    return () => {
      active = false;
    };
  }, [book.meta.coverUrl]);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[
        readerHomeStyles.bookOption,
        {
          backgroundColor: selected ? colors.card : colors.background,
          borderColor: selected ? colors.foreground : colors.border,
        },
      ]}
    >
      {coverUri ? (
        <Image source={{ uri: coverUri }} style={readerHomeStyles.bookOptionCover} />
      ) : (
        <View style={[readerHomeStyles.bookOptionCover, { backgroundColor: colors.muted }]}>
          <BookOpenIcon size={19} color={colors.mutedForeground} />
        </View>
      )}
      <Text
        numberOfLines={2}
        style={[
          readerHomeStyles.bookOptionTitle,
          { color: selected ? colors.foreground : colors.mutedForeground },
        ]}
      >
        {book.meta.title}
      </Text>
    </TouchableOpacity>
  );
}

function ReaderHomeScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const books = useLibraryStore((state) => state.books);
  const { colors } = useTheme();
  const availableBooks = useMemo(
    () =>
      [...books]
        .filter((book) => !book.deletedAt)
        .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0)),
    [books],
  );
  const [selectedBookId, setSelectedBookId] = useState<string>();
  const selectedBook =
    availableBooks.find((book) => book.id === selectedBookId) ?? availableBooks[0];

  useEffect(() => {
    if (selectedBook && selectedBook.id !== selectedBookId) {
      setSelectedBookId(selectedBook.id);
    }
  }, [selectedBook, selectedBookId]);

  // When the library is empty, this doubles as the useful empty state/import screen.
  if (!selectedBook) return <LibraryScreen />;
  return (
    <SafeAreaView style={[readerHomeStyles.container, { backgroundColor: colors.background }]}>
      <View style={readerHomeStyles.content}>
        <View>
          <Text style={[readerHomeStyles.selectorLabel, { color: colors.mutedForeground }]}>
            ВЫБЕРИТЕ КНИГУ
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={readerHomeStyles.bookSelector}
          >
            {availableBooks.map((book) => (
              <ReaderBookOption
                key={book.id}
                book={book}
                selected={book.id === selectedBook.id}
                onPress={() => setSelectedBookId(book.id)}
              />
            ))}
          </ScrollView>
        </View>
        <Text style={[readerHomeStyles.eyebrow, { color: colors.primary }]}>
          ПРОДОЛЖИТЬ ЧТЕНИЕ
        </Text>
        <Text style={[readerHomeStyles.title, { color: colors.foreground }]}>
          {selectedBook.meta.title}
        </Text>
        {selectedBook.meta.author ? (
          <Text style={[readerHomeStyles.author, { color: colors.mutedForeground }]}>
            {selectedBook.meta.author}
          </Text>
        ) : null}
        <View style={[readerHomeStyles.progressTrack, { backgroundColor: colors.muted }]}>
          <View
            style={[
              readerHomeStyles.progressFill,
              {
                backgroundColor: colors.primary,
                width: `${Math.round(selectedBook.progress * 100)}%`,
              },
            ]}
          />
        </View>
        <Text style={[readerHomeStyles.progress, { color: colors.mutedForeground }]}>
          Прочитано {Math.round(selectedBook.progress * 100)}%
        </Text>
        <TouchableOpacity
          style={[readerHomeStyles.button, { backgroundColor: colors.foreground }]}
          onPress={() =>
            navigation.navigate("Reader", {
              bookId: selectedBook.id,
              cfi: selectedBook.currentCfi,
            })
          }
        >
          <BookOpenIcon size={20} color={colors.background} />
          <Text style={[readerHomeStyles.buttonText, { color: colors.background }]}>Открыть книгу</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[readerHomeStyles.narraButton, { borderColor: colors.border }]}
          onPress={() => navigation.navigate("NarraCharacters", { bookId: selectedBook.id })}
        >
          <Text style={[readerHomeStyles.narraButtonText, { color: colors.foreground }]}>
            ✦ Герои, голоса и изображения
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function JourneyScreen() {
  return <ProfileScreen section="journey" />;
}

const readerHomeStyles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: "center", paddingVertical: 24 },
  selectorLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    paddingHorizontal: 28,
    marginBottom: 10,
  },
  bookSelector: { paddingHorizontal: 28, gap: 10 },
  bookOption: {
    width: 92,
    minHeight: 110,
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 7,
  },
  bookOptionCover: {
    width: 44,
    height: 62,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  bookOptionTitle: { fontSize: 10, lineHeight: 13, fontWeight: "700", marginTop: 6 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginTop: 28,
    paddingHorizontal: 28,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "900",
    marginTop: 10,
    paddingHorizontal: 28,
  },
  author: { fontSize: 15, marginTop: 7, paddingHorizontal: 28 },
  progressTrack: {
    height: 5,
    borderRadius: 999,
    overflow: "hidden",
    marginTop: 28,
    marginHorizontal: 28,
  },
  progressFill: { height: "100%", borderRadius: 999 },
  progress: { fontSize: 12, marginTop: 8, marginHorizontal: 28 },
  button: {
    minHeight: 52,
    borderRadius: 999,
    flexDirection: "row",
    gap: 9,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 25,
    marginHorizontal: 28,
  },
  buttonText: { fontSize: 15, fontWeight: "800" },
  narraButton: {
    minHeight: 52,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 11,
    marginHorizontal: 28,
  },
  narraButtonText: { fontSize: 14, fontWeight: "700" },
});

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

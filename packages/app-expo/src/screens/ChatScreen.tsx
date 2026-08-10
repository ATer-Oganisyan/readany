import { Text } from "@/components/ui/Typography";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
/**
 * ChatScreen — full AI chat matching app-mobile ChatPage layout.
 * Sliding sidebar for threads, compact header, empty state with suggestions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useStreamingChat } from "@/hooks";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { resolveActiveAIConfig } from "@/lib/ai/resolve-active-ai-config";
import { useLibraryStore } from "@/stores";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { AttachedQuote } from "@readany/core/types";
import type { CitationPart } from "@readany/core/types/message";
import {
  convertToMessageV2,
  formatRelativeTimeShort,
  getMonthLabel,
  groupThreadsByTime,
  mergeMessagesWithStreaming,
} from "@readany/core/utils";

import { NarraChat } from "@/components/chat/NarraChat";
import { AnimatedNarraFace } from "@/components/chat/animated-narra-face";
import { MessageCirclePlusIcon, Trash2Icon, XIcon } from "@/components/ui/Icon";
import { fontSize as fs, fontWeight as fw, radius, useColors, withOpacity } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";

type ChatRoute = RouteProp<RootStackParamList, "Chat"> | RouteProp<RootStackParamList, "BookChat">;

const renderNarraAvatar = () => <AnimatedNarraFace width={27} height={28} />;

export function ChatScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<ChatRoute>();
  const bookParams = route.name === "BookChat" ? route.params : undefined;
  const bookId = bookParams?.bookId;
  const books = useLibraryStore((state) => state.books);
  const book = useMemo(
    () => (bookId ? books.find((item) => item.id === bookId) : undefined),
    [bookId, books],
  );
  const [quotes, setQuotes] = useState<AttachedQuote[]>([]);

  useEffect(() => {
    navigation.setOptions({ title: bookId ? "Нарра" : "Narra AI" });
  }, [bookId, navigation]);

  useEffect(() => {
    if (!bookParams?.selectedText || quotes.length > 0) return;
    setQuotes([
      {
        id: `quote-${Date.now()}`,
        text: bookParams.selectedText,
        source: bookParams.chapterTitle || undefined,
      },
    ]);
  }, [bookParams?.chapterTitle, bookParams?.selectedText, quotes.length]);
  const layout = useResponsiveLayout();
  const isTabletLandscape = layout.isTabletLandscape;
  const sidebarWidth = isTabletLandscape
    ? Math.min(360, layout.width * 0.28)
    : Math.min(layout.width * 0.75, 300);
  const s = useMemo(
    () =>
      makeStyles(colors, {
        isTabletLandscape,
        sidebarWidth,
        horizontalPadding: layout.horizontalPadding,
      }),
    [colors, isTabletLandscape, layout.horizontalPadding, sidebarWidth],
  );

  // Thread sidebar
  const [showSidebar, setShowSidebar] = useState(false);
  const sidebarAnim = useRef(new Animated.Value(-sidebarWidth)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const showSidebarRef = useRef(showSidebar);
  useEffect(() => {
    showSidebarRef.current = showSidebar;
  }, [showSidebar]);

  useEffect(() => {
    if (isTabletLandscape) {
      setShowSidebar(false);
      sidebarAnim.setValue(0);
      backdropAnim.setValue(0);
      return;
    }
    if (!showSidebarRef.current) {
      sidebarAnim.setValue(-sidebarWidth);
    }
  }, [backdropAnim, isTabletLandscape, sidebarAnim, sidebarWidth]);

  const closeSidebar = useCallback(() => {
    if (isTabletLandscape) return;
    Animated.parallel([
      Animated.spring(sidebarAnim, {
        toValue: -sidebarWidth,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setShowSidebar(false);
    });
  }, [backdropAnim, isTabletLandscape, sidebarAnim, sidebarWidth]);

  // Chat store
  const threads = useChatStore((s) => s.threads);
  const generalActiveThreadId = useChatStore((s) => s.generalActiveThreadId);
  const initialized = useChatStore((s) => s.initialized);
  const loadAllThreads = useChatStore((s) => s.loadAllThreads);
  const loadThreads = useChatStore((s) => s.loadThreads);
  const removeThread = useChatStore((s) => s.removeThread);
  const setGeneralActiveThread = useChatStore((s) => s.setGeneralActiveThread);
  const setBookActiveThread = useChatStore((s) => s.setBookActiveThread);
  const getActiveThreadId = useChatStore((s) => s.getActiveThreadId);
  const getThreadsForContext = useChatStore((s) => s.getThreadsForContext);

  useEffect(() => {
    if (bookId) {
      void loadThreads(bookId);
    } else if (!initialized) {
      void loadAllThreads();
    }
  }, [bookId, initialized, loadAllThreads, loadThreads]);

  const contextThreads = getThreadsForContext(bookId);
  const activeThreadId = bookId ? getActiveThreadId(bookId) : generalActiveThreadId;
  const firstContextThreadId = contextThreads[0]?.id;

  useEffect(() => {
    if (bookId && !activeThreadId && firstContextThreadId) {
      setBookActiveThread(bookId, firstContextThreadId);
    }
  }, [activeThreadId, bookId, firstContextThreadId, setBookActiveThread]);

  // Streaming chat
  const {
    isStreaming,
    currentMessage,
    currentStep,
    error,
    errorThreadId,
    sendMessage,
    retryLastMessage,
    stopStream,
  } = useStreamingChat(bookId ? { book, bookId } : undefined);

  // Messages - compute directly without useMemo to ensure reactivity
  const activeThread = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId)
    : null;

  const activeCurrentMessage =
    activeThread?.id === currentMessage?.threadId ? currentMessage : null;
  const displayMessages = convertToMessageV2(activeThread?.messages || []);
  const allMessages = mergeMessagesWithStreaming(
    displayMessages,
    activeCurrentMessage,
    isStreaming,
  );

  // Handlers
  const handleSend = useCallback(
    async (text: string, deepThinking: boolean, spoilerFree: boolean, quotes?: AttachedQuote[]) => {
      // Validate AI config before sending
      const state = useSettingsStore.getState();
      const resolvedAIConfig = await resolveActiveAIConfig(state);

      if (!resolvedAIConfig) {
        Alert.alert(
          t("chat.configRequired", "需要配置 AI"),
          t("chat.configRequiredMessage", "请先在设置中配置 AI 端点和模型"),
          [
            { text: t("common.cancel", "取消"), style: "cancel" },
            {
              text: t("common.settings", "去设置"),
              onPress: () => navigation.navigate("AISettings"),
            },
          ],
        );
        return;
      }

      await sendMessage(text, bookId, deepThinking, spoilerFree, quotes, resolvedAIConfig);
    },
    [bookId, navigation, sendMessage, t],
  );

  const handleRetry = useCallback(async () => {
    const state = useSettingsStore.getState();
    const resolvedAIConfig = await resolveActiveAIConfig(state);

    if (!resolvedAIConfig) {
      Alert.alert(
        t("chat.configRequired", "Настройте ИИ"),
        t("chat.configRequiredMessage", "Добавьте адрес API, ключ и модель в настройках"),
        [
          { text: t("common.cancel", "Отмена"), style: "cancel" },
          {
            text: t("common.settings", "Настройки"),
            onPress: () => navigation.navigate("AISettings"),
          },
        ],
      );
      return;
    }

    await retryLastMessage(resolvedAIConfig);
  }, [navigation, retryLastMessage, t]);

  const handleNewThread = useCallback(() => {
    if (bookId) {
      setBookActiveThread(bookId, null);
    } else {
      setGeneralActiveThread(null);
    }
    closeSidebar();
  }, [bookId, closeSidebar, setBookActiveThread, setGeneralActiveThread]);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      if (bookId) {
        setBookActiveThread(bookId, threadId);
      } else {
        setGeneralActiveThread(threadId);
      }
      closeSidebar();
    },
    [bookId, closeSidebar, setBookActiveThread, setGeneralActiveThread],
  );

  const handleRemoveQuote = useCallback((id: string) => {
    setQuotes((current) => current.filter((quote) => quote.id !== id));
  }, []);

  const handleCitationClick = useCallback(
    (citation: CitationPart) => {
      if (!citation.bookId) return;
      void openMobileBook({
        bookId: citation.bookId,
        navigation,
        t,
        cfi: citation.cfi,
        highlight: true,
      });
    },
    [navigation, t],
  );

  const formatTime = useCallback((ts: number) => formatRelativeTimeShort(ts, t), [t]);

  const groupedThreads = useMemo(() => {
    const grouped = groupThreadsByTime(contextThreads);
    const sections: { key: string; label: string; threads: typeof contextThreads }[] = [
      { key: "today", label: t("chat.today", "今天"), threads: grouped.today },
      { key: "yesterday", label: t("chat.yesterday", "昨天"), threads: grouped.yesterday },
      { key: "last7Days", label: t("chat.last7Days", "7 天内"), threads: grouped.last7Days },
      { key: "last30Days", label: t("chat.last30Days", "30 天内"), threads: grouped.last30Days },
    ];

    const olderByMonth = new Map<string, typeof contextThreads>();
    for (const thread of grouped.older) {
      const monthLabel = getMonthLabel(thread.updatedAt);
      let monthThreads = olderByMonth.get(monthLabel);
      if (!monthThreads) {
        monthThreads = [];
        olderByMonth.set(monthLabel, monthThreads);
      }
      monthThreads.push(thread);
    }
    const sortedMonths = [...olderByMonth.keys()].sort((a, b) => b.localeCompare(a));
    for (const month of sortedMonths) {
      const monthThreads = olderByMonth.get(month);
      if (monthThreads) {
        sections.push({ key: month, label: month, threads: monthThreads });
      }
    }

    return sections;
  }, [contextThreads, t]);

  const renderSidebarContent = useCallback(
    (closable: boolean) => (
      <>
        <View style={s.sidebarHeader}>
          <Text style={s.sidebarTitle}>{t("chat.history", "历史记录")}</Text>
          {closable ? (
            <TouchableOpacity style={s.iconBtn} onPress={closeSidebar}>
              <XIcon size={16} color={colors.foreground} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={s.newChatBtn} onPress={handleNewThread} activeOpacity={0.75}>
              <MessageCirclePlusIcon size={15} color={colors.foreground} />
            </TouchableOpacity>
          )}
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
        >
          {contextThreads.length === 0 ? (
            <View style={s.sidebarEmpty}>
              <Text style={s.sidebarEmptyText}>{t("chat.noConversations", "暂无对话")}</Text>
            </View>
          ) : (
            groupedThreads.map(({ key, label, threads }) => {
              if (threads.length === 0) return null;
              return (
                <View key={key}>
                  <Text style={s.sectionLabel}>{label}</Text>
                  {threads.map((thread) => {
                    const isActive = thread.id === activeThreadId;
                    const lastMsg =
                      thread.messages.length > 0
                        ? thread.messages[thread.messages.length - 1]
                        : null;
                    const preview = lastMsg?.content?.slice(0, 60) || "";
                    return (
                      <TouchableOpacity
                        key={thread.id}
                        style={[s.threadItem, isActive && s.threadItemActive]}
                        onPress={() => handleSelectThread(thread.id)}
                        activeOpacity={0.7}
                      >
                        <View style={s.threadContent}>
                          <View style={s.threadTitleRow}>
                            <Text
                              style={[s.threadTitle, isActive && s.threadTitleActive]}
                              numberOfLines={1}
                            >
                              {thread.title || t("chat.newChat", "新对话")}
                            </Text>
                            <Text style={s.threadTime}>{formatTime(thread.updatedAt)}</Text>
                          </View>
                          {preview ? (
                            <Text style={s.threadPreview} numberOfLines={1}>
                              {preview}
                            </Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          style={s.threadDeleteBtn}
                          onPress={() => removeThread(thread.id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Trash2Icon size={12} color={colors.mutedForeground} />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })
          )}
        </ScrollView>
      </>
    ),
    [
      closeSidebar,
      colors.foreground,
      colors.mutedForeground,
      activeThreadId,
      contextThreads.length,
      formatTime,
      groupedThreads,
      handleNewThread,
      handleSelectThread,
      removeThread,
      s,
      t,
    ],
  );

  return (
    <View style={[s.container, { paddingBottom: insets.bottom }]}>
      <View style={s.shell}>
        {isTabletLandscape && (
          <View style={[s.sidebarDocked, { paddingTop: insets.top }]}>
            {renderSidebarContent(false)}
          </View>
        )}

        <View style={s.mainColumn}>
          {/* Content */}
          <View style={s.content}>
            <NarraChat
              messages={allMessages}
              assistantAvatar={renderNarraAvatar}
              isStreaming={isStreaming}
              currentStep={currentStep}
              onSend={handleSend}
              onStop={stopStream}
              errorMessage={
                error && activeThread?.id === errorThreadId
                  ? t("chat.responseFailed", "Не удалось получить ответ")
                  : undefined
              }
              retryLabel={t("common.retry", "Повторить")}
              onRetry={handleRetry}
              quotes={quotes}
              onRemoveQuote={handleRemoveQuote}
              onCitationClick={handleCitationClick}
              autoFocus
            />
          </View>
        </View>
      </View>

      {/* Thread sidebar overlay */}
      {!isTabletLandscape && (
        <View
          style={[StyleSheet.absoluteFill, { zIndex: 20 }]}
          pointerEvents={showSidebar ? "box-none" : "none"}
        >
          <Animated.View
            style={[s.sidebarBackdrop, { opacity: backdropAnim }]}
            pointerEvents={showSidebar ? "auto" : "none"}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSidebar} />
          </Animated.View>
          <Animated.View
            style={[
              s.sidebar,
              { paddingTop: insets.top, transform: [{ translateX: sidebarAnim }] },
            ]}
          >
            {renderSidebarContent(true)}
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (
  colors: ThemeColors,
  layout: { isTabletLandscape: boolean; sidebarWidth: number; horizontalPadding: number },
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    shell: { flex: 1, flexDirection: layout.isTabletLandscape ? "row" : "column" },
    sidebarDocked: {
      width: layout.sidebarWidth,
      backgroundColor: colors.background,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      paddingHorizontal: 12,
      paddingBottom: 12,
    },
    mainColumn: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      height: 44,
      paddingHorizontal: layout.isTabletLandscape ? 20 : 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
      zIndex: 10,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    headerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    iconBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    content: { flex: 1 },

    // Sidebar
    sidebarBackdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: "rgba(0,0,0,0.2)",
    },
    sidebar: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: layout.sidebarWidth,
      backgroundColor: colors.background,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      paddingHorizontal: 12,
      paddingBottom: 12,
      shadowColor: "#000",
      shadowOffset: { width: 2, height: 0 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 8,
    },
    newChatBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: withOpacity(colors.muted, 0.72),
    },
    sidebarHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
    },
    sidebarTitle: {
      fontSize: fs.sm,
      fontWeight: fw.semibold,
      color: colors.foreground,
    },
    sidebarEmpty: {
      paddingVertical: 40,
      alignItems: "center",
    },
    sidebarEmptyText: {
      fontSize: fs.xs,
      color: colors.mutedForeground,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: fw.medium,
      color: colors.mutedForeground,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    threadItem: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      borderRadius: radius.md,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    threadItemActive: {
      backgroundColor: withOpacity(colors.primary, 0.08),
    },
    threadContent: {
      flex: 1,
      gap: 2,
    },
    threadTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    threadTitle: {
      fontSize: fs.sm,
      fontWeight: fw.medium,
      color: colors.foreground,
      flex: 1,
    },
    threadTitleActive: {
      color: colors.primary,
    },
    threadTime: {
      fontSize: 11,
      color: colors.mutedForeground,
      opacity: 0.5,
    },
    threadPreview: {
      fontSize: 13,
      color: colors.mutedForeground,
    },
    threadDeleteBtn: {
      marginTop: 2,
      padding: 4,
    },
  });

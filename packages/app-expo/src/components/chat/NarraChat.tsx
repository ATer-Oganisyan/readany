import { fontFamily, useTheme, withOpacity } from "@/styles/theme";
import { useHeaderHeight } from "@react-navigation/elements";
import { useFocusEffect } from "@react-navigation/native";
import type { AttachedQuote } from "@readany/core/types";
import type { CitationPart, MessageV2, QuotePart } from "@readany/core/types/message";
import * as Clipboard from "expo-clipboard";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, type TextInput, Vibration, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Chat,
  type ChatThemeColors,
  type IMessage,
  type MessageMenuItem,
  type PartialChatTheme,
  type ReplyMessage,
  Send,
  type SendProps,
  resolveTheme,
} from "../../../vendor/react-native-chat/src";

const USER_ID = "narra-user";
const ASSISTANT_ID = "narra-ai";
const REACTION_EMOJIS = ["👍", "❤️", "🔥", "👏", "😁", "🤔"];

type StreamingStep = "thinking" | "tool_calling" | "responding" | "idle";

interface NarraMessage extends IMessage {
  source?: MessageV2;
}

export interface NarraChatProps {
  messages: MessageV2[];
  isStreaming?: boolean;
  currentStep?: StreamingStep;
  placeholder?: string;
  quotes?: AttachedQuote[];
  onRemoveQuote?: (id: string) => void;
  onCitationClick?: (citation: CitationPart) => void;
  onSend: (
    text: string,
    deepThinking: boolean,
    spoilerFree: boolean,
    quotes?: AttachedQuote[],
  ) => void | Promise<void>;
  onStop?: () => void;
  errorMessage?: string | null;
  retryLabel?: string;
  onRetry?: () => void | Promise<void>;
  autoFocus?: boolean;
  initialText?: string;
  /** Deterministic appearance and reactions used by the visual-comparison stories. */
  colorScheme?: "light" | "dark";
  initialReactions?: Record<string, string[]>;
  /** Deterministically exposes the real long-press menu in visual stories. */
  previewContextMenuMessageId?: string;
}

function messageText(message: MessageV2, includeQuotes = true): string {
  const body: string[] = [];
  const citations: CitationPart[] = [];

  for (const part of message.parts) {
    switch (part.type) {
      case "text":
        if (part.text.trim()) body.push(part.text);
        break;
      case "quote":
        if (includeQuotes) {
          const source = part.source ? `\n> — ${part.source}` : "";
          body.push(`> ${part.text.replaceAll("\n", "\n> ")}${source}`);
        }
        break;
      case "citation":
        citations.push(part);
        break;
      case "mindmap":
        body.push(`**${part.title}**\n\n${part.markdown}`);
        break;
      case "mermaid":
        body.push(`**${part.title}**\n\n\`\`\`mermaid\n${part.chart}\n\`\`\``);
        break;
      case "aborted":
        body.push("_Ответ остановлен._");
        break;
      // The 4.2 typing and streaming states replace Narra's old visible
      // reasoning/tool cards. Internal reasoning remains in message data.
      case "reasoning":
      case "tool_call":
        break;
    }
  }

  if (citations.length) {
    const sources = citations
      .sort((a, b) => (a.citationIndex ?? 0) - (b.citationIndex ?? 0))
      .map((citation, index) => {
        const number = citation.citationIndex ?? index + 1;
        return `[${number}. ${citation.chapterTitle}](narra-citation://${encodeURIComponent(citation.id)})`;
      });
    body.push(`**Источники**\n\n${sources.join("  \n")}`);
  }

  return body.join("\n\n");
}

function quoteReply(part: QuotePart): ReplyMessage {
  return {
    _id: part.id,
    text: part.text,
    user: { _id: `quote-${part.id}`, name: part.source ?? "Цитата из книги" },
  };
}

function replyFromMessage(message: NarraMessage): ReplyMessage {
  return {
    _id: message._id,
    text: (message.source ? messageText(message.source) : message.text) || message.text,
    user: message.user,
    image: message.image,
    audio: message.audio,
  };
}

function toChatMessage(
  message: MessageV2,
  options: {
    streamingMessageId?: string;
    reactions?: string[];
    selected: boolean;
    selectionMode: boolean;
    initialContextMenuVisible: boolean;
  },
): NarraMessage {
  const quote = message.parts.find((part): part is QuotePart => part.type === "quote");
  const text = messageText(message, false);

  return {
    _id: message.id,
    text: text || (quote ? "\u200B" : ""),
    createdAt: message.createdAt,
    user: {
      _id: message.role === "user" ? USER_ID : ASSISTANT_ID,
      name: message.role === "user" ? "Вы" : "Narra AI",
    },
    system: message.role === "system",
    // Persisted user messages have reached the local conversation and use the
    // Telegram double-check state. Pending live sends can still opt into the
    // library's clock/single-check states independently.
    received: message.role === "user",
    streaming: message.id === options.streamingMessageId,
    replyMessage: quote ? quoteReply(quote) : undefined,
    reactions: options.reactions?.map((emoji) => ({ emoji, userIds: [USER_ID] })),
    selected: options.selected,
    selectionMode: options.selectionMode,
    initialContextMenuVisible: options.initialContextMenuVisible,
    source: message,
  };
}

export function NarraChat({
  messages,
  isStreaming = false,
  currentStep = "idle",
  placeholder = "Сообщение",
  quotes = [],
  onRemoveQuote,
  onCitationClick,
  onSend,
  onStop,
  errorMessage,
  retryLabel = "Повторить",
  onRetry,
  autoFocus = false,
  initialText = "",
  colorScheme,
  initialReactions = {},
  previewContextMenuMessageId,
}: NarraChatProps) {
  const { colors, isDark } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [deepThinking, setDeepThinking] = useState(false);
  const [spoilerFree, setSpoilerFree] = useState(false);
  const [replyMessage, setReplyMessage] = useState<ReplyMessage | null>(null);
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(() => new Set());
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set());
  const [reactionState, setReactionState] = useState<Record<string, string[]>>(
    () => initialReactions,
  );

  const resolvedScheme = colorScheme ?? (isDark ? "dark" : "light");

  const streamingMessageId =
    isStreaming && messages.at(-1)?.role === "assistant" ? messages.at(-1)?.id : undefined;
  const chatMessages = useMemo(
    () =>
      messages
        .filter((message) => !hiddenMessageIds.has(message.id))
        .map((message) =>
          toChatMessage(message, {
            streamingMessageId,
            reactions: reactionState[message.id],
            selected: selectedMessageIds.has(message.id),
            selectionMode: selectedMessageIds.size > 0,
            initialContextMenuVisible: message.id === previewContextMenuMessageId,
          }),
        )
        .reverse(),
    [
      hiddenMessageIds,
      messages,
      previewContextMenuMessageId,
      reactionState,
      selectedMessageIds,
      streamingMessageId,
    ],
  );

  const theme = useMemo<PartialChatTheme>(
    () => ({
      colors: {
        accent: colors.primary,
        background: colors.backgroundSecondary,
        incomingBubble: colors.elevation1,
        outgoingBubble: colors.primary,
        incomingText: colors.foreground,
        outgoingText: colors.primaryForeground,
        incomingMeta: colors.mutedForeground,
        outgoingMeta: withOpacity(colors.primaryForeground, 0.65),
        senderName: colors.primary,
        ticksSent: withOpacity(colors.primaryForeground, 0.65),
        ticksRead: colors.primaryForeground,
        separator: colors.border,
        inputBackground: colors.elevation1,
        inputBarBackground: colors.backgroundSecondary,
        inputText: colors.foreground,
        placeholder: colors.mutedForeground,
        dayPillBackground: colors.elevation2,
        dayPillText: colors.foreground,
        surface: colors.elevation1,
        reactionBackground: colors.elevation2,
        reactionActiveBackground: withOpacity(colors.primary, 0.16),
        outgoingOverlay: withOpacity(colors.primaryForeground, 0.14),
        error: colors.destructive,
        inputFieldBorder: colors.border,
      },
      typography: {
        message: { fontSize: 16, lineHeight: 22, fontWeight: "400" },
        time: { fontSize: 11, fontWeight: "400" },
        senderName: { fontSize: 12, fontWeight: "600" },
        day: { fontSize: 12, fontWeight: "600" },
        system: { fontSize: 13, fontWeight: "400" },
      },
    }),
    [colors],
  );

  const chatTheme = useMemo(
    () => resolveTheme(resolvedScheme, theme, theme),
    [resolvedScheme, theme],
  );

  useFocusEffect(
    useCallback(() => {
      if (!autoFocus) return;
      const timer = setTimeout(() => inputRef.current?.focus(), 250);
      return () => {
        clearTimeout(timer);
        inputRef.current?.blur();
      };
    }, [autoFocus]),
  );

  const toggleSelected = useCallback((messageId: string) => {
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  const deleteMessages = useCallback((messageIds: Iterable<string>) => {
    const ids = new Set(messageIds);
    setHiddenMessageIds((current) => new Set([...current, ...ids]));
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
    setReplyMessage((current) => (current && ids.has(String(current._id)) ? null : current));
  }, []);

  const handleSend = useCallback(
    (outgoing: NarraMessage[]) => {
      const outgoingMessage = outgoing[0];
      const text = outgoingMessage?.text?.trim() ?? "";
      const reply = outgoingMessage?.replyMessage;
      const replyQuote: AttachedQuote | undefined = reply?.text
        ? {
            id: `reply-${String(reply._id)}`,
            text: reply.text,
            source: reply.user?.name,
          }
        : undefined;
      const attachedQuotes = replyQuote ? [...quotes, replyQuote] : quotes;

      if (!text && attachedQuotes.length === 0) return;
      void onSend(
        text,
        deepThinking,
        spoilerFree,
        attachedQuotes.length ? attachedQuotes : undefined,
      );
      for (const quote of quotes) onRemoveQuote?.(quote.id);
      setReplyMessage(null);
      setDeepThinking(false);
      setSpoilerFree(false);
    },
    [deepThinking, onRemoveQuote, onSend, quotes, spoilerFree],
  );

  const messageActions = useCallback(
    (message: NarraMessage): MessageMenuItem[] => {
      if (!message.source) return [];
      const text = messageText(message.source);
      return [
        {
          label: "Ответить",
          icon: ({ color, size }) => <MenuGlyph kind="reply" color={color} size={size} />,
          onPress: () => setReplyMessage(replyFromMessage(message)),
        },
        {
          label: "Скопировать",
          icon: ({ color, size }) => <MenuGlyph kind="copy" color={color} size={size} />,
          onPress: () => void Clipboard.setStringAsync(text),
        },
        {
          label: "Удалить",
          icon: ({ color, size }) => <MenuGlyph kind="delete" color={color} size={size} />,
          destructive: true,
          onPress: () => deleteMessages([String(message._id)]),
        },
        {
          label: "Выбрать",
          icon: ({ color, size }) => <MenuGlyph kind="select" color={color} size={size} />,
          separatorBefore: true,
          onPress: () => toggleSelected(String(message._id)),
        },
      ];
    },
    [deleteMessages, toggleSelected],
  );

  const handleMessageLink = useCallback(
    (message: NarraMessage, url: string) => {
      if (!message.source || !url.startsWith("narra-citation://")) return;
      const citationId = decodeURIComponent(url.slice("narra-citation://".length));
      const citation = message.source.parts.find(
        (part): part is CitationPart => part.type === "citation" && part.id === citationId,
      );
      if (citation) onCitationClick?.(citation);
    },
    [onCitationClick],
  );

  const toggleReaction = useCallback((message: NarraMessage | undefined, emoji: string) => {
    if (!message) return;
    const messageId = String(message._id);
    setReactionState((current) => {
      const active = current[messageId] ?? [];
      return {
        ...current,
        [messageId]: active.includes(emoji)
          ? active.filter((item) => item !== emoji)
          : [...active, emoji],
      };
    });
  }, []);

  const attachmentActions = useMemo(
    () => [
      {
        title: deepThinking ? "Глубокий анализ · включён" : "Глубокий анализ",
        action: () => setDeepThinking((value) => !value),
      },
      {
        title: spoilerFree ? "Без спойлеров · включено" : "Без спойлеров",
        action: () => setSpoilerFree((value) => !value),
      },
    ],
    [deepThinking, spoilerFree],
  );

  const renderAccessory = useCallback(() => {
    if (!errorMessage && !quotes.length && !deepThinking && !spoilerFree) return null;
    return (
      <View
        style={[
          styles.accessory,
          {
            backgroundColor: chatTheme.colors.inputBarBackground,
            borderBottomColor: chatTheme.colors.separator,
          },
        ]}
      >
        {errorMessage ? (
          <View
            style={[
              styles.errorState,
              {
                backgroundColor: withOpacity(colors.destructive, 0.08),
                borderColor: withOpacity(colors.destructive, 0.24),
              },
            ]}
            accessibilityRole="alert"
          >
            <Text style={[styles.errorMessage, { color: colors.foreground }]}>{errorMessage}</Text>
            <Pressable
              onPress={() => void onRetry?.()}
              disabled={!onRetry}
              accessibilityRole="button"
              accessibilityLabel={retryLabel}
              hitSlop={8}
            >
              <Text style={[styles.retryLabel, { color: colors.destructive }]}>{retryLabel}</Text>
            </Pressable>
          </View>
        ) : null}
        {quotes.map((quote) => (
          <AccessoryRow
            key={quote.id}
            title={quote.source ?? "Цитата из книги"}
            text={quote.text}
            onClose={() => onRemoveQuote?.(quote.id)}
            colors={chatTheme.colors}
          />
        ))}
        {deepThinking && (
          <AccessoryRow
            title="Глубокий анализ"
            text="Расширенное рассуждение включено"
            onClose={() => setDeepThinking(false)}
            colors={chatTheme.colors}
          />
        )}
        {spoilerFree && (
          <AccessoryRow
            title="Без спойлеров"
            text="Ответ учитывает текущий прогресс чтения"
            onClose={() => setSpoilerFree(false)}
            colors={chatTheme.colors}
          />
        )}
      </View>
    );
  }, [
    chatTheme,
    colors,
    deepThinking,
    errorMessage,
    onRemoveQuote,
    onRetry,
    quotes,
    retryLabel,
    spoilerFree,
  ]);

  const renderSend = useCallback(
    (props: SendProps<NarraMessage>) => {
      if (isStreaming) {
        return (
          <Pressable
            style={[styles.stopButton, { backgroundColor: chatTheme.colors.accent }]}
            onPress={onStop}
            accessibilityRole="button"
            accessibilityLabel="Остановить ответ"
          >
            <View style={styles.stopGlyph} />
          </Pressable>
        );
      }

      const canSend = Boolean(props.text?.trim() || quotes.length || replyMessage);
      if (!canSend) return <View style={styles.sendSlot} />;
      return <Send {...props} isTextOptional={Boolean(quotes.length || replyMessage)} />;
    },
    [chatTheme.colors.accent, isStreaming, onStop, quotes.length, replyMessage],
  );

  const lastMessage = messages.at(-1);
  const showInitialStreaming =
    isStreaming &&
    currentStep !== "idle" &&
    (!lastMessage || lastMessage.role !== "assistant" || !messageText(lastMessage).trim());

  return (
    <View style={styles.root}>
      <Chat<NarraMessage>
        messages={chatMessages}
        initialText={initialText}
        user={{ _id: USER_ID, name: "Вы" }}
        onSend={handleSend}
        locale="ru"
        colorScheme={resolvedScheme}
        theme={theme}
        darkTheme={theme}
        renderBackground={() => <TelegramWallpaper dark={resolvedScheme === "dark"} />}
        renderAccessory={renderAccessory}
        renderSend={renderSend}
        actions={attachmentActions}
        actionSheetOptionTintColor={chatTheme.colors.accent}
        isTyping={showInitialStreaming}
        messageActions={messageActions}
        reactions={{
          isEnabled: true,
          emojis: REACTION_EMOJIS,
          onReactionPress: toggleReaction,
        }}
        reply={{
          message: replyMessage,
          onClear: () => setReplyMessage(null),
          swipe: {
            isEnabled: !isStreaming,
            direction: "left",
            onSwipe: (message) => setReplyMessage(replyFromMessage(message)),
          },
        }}
        onPressMessage={(_context, message) => {
          if (selectedMessageIds.size) toggleSelected(String(message._id));
        }}
        onLongPressMessage={() => {
          Vibration.vibrate(10);
        }}
        messageTextProps={{
          markdown: true,
          onPress: handleMessageLink,
          customTextStyle: { fontFamily: fontFamily.regular },
        }}
        timeTextStyle={{
          left: { fontFamily: fontFamily.regular },
          right: { fontFamily: fontFamily.regular },
        }}
        isDayAnimationEnabled
        isScrollToBottomEnabled
        textInputRef={inputRef}
        textInputProps={{
          placeholder,
          placeholderTextColor: chatTheme.colors.placeholder,
          editable: !isStreaming,
          multiline: true,
          style: {
            fontFamily: fontFamily.regular,
            fontSize: 17,
            lineHeight: 22,
            color: chatTheme.colors.inputText,
          },
          autoCapitalize: "sentences",
        }}
        messagesContainerStyle={{ backgroundColor: chatTheme.colors.background }}
        listProps={{
          keyboardDismissMode: "interactive",
          keyboardShouldPersistTaps: "handled",
        }}
        keyboardAvoidingViewProps={{
          // Keyboard coordinates are screen-relative. Native-stack screens
          // start below the header; standalone comparison stories start below
          // the status bar, so both need that offset to keep the 45 pt panel
          // directly above the keyboard.
          keyboardVerticalOffset: headerHeight || insets.top,
        }}
      />

      {selectedMessageIds.size > 0 && (
        <View
          style={[styles.selectionToolbar, { backgroundColor: chatTheme.colors.menuBackground }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Отменить выбор"
            onPress={() => setSelectedMessageIds(new Set())}
          >
            <Text style={[styles.selectionAction, { color: chatTheme.colors.accent }]}>Отмена</Text>
          </Pressable>
          <Text style={[styles.selectionCount, { color: chatTheme.colors.menuText }]}>
            Выбрано: {selectedMessageIds.size}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Удалить выбранные"
            onPress={() => deleteMessages(selectedMessageIds)}
          >
            <Text style={[styles.selectionAction, { color: chatTheme.colors.error }]}>Удалить</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function AccessoryRow({
  title,
  text,
  onClose,
  colors,
}: {
  title: string;
  text: string;
  onClose: () => void;
  colors: Pick<ChatThemeColors, "accent" | "inputText" | "placeholder">;
}) {
  return (
    <View style={styles.accessoryRow}>
      <View style={[styles.accessoryLine, { backgroundColor: colors.accent }]} />
      <View style={styles.accessoryCopy}>
        <Text style={[styles.accessoryTitle, { color: colors.accent }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.accessoryText, { color: colors.inputText }]} numberOfLines={1}>
          {text}
        </Text>
      </View>
      <Pressable
        style={styles.closeAccessory}
        hitSlop={8}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={`Убрать: ${title}`}
      >
        <Text style={[styles.closeAccessoryText, { color: colors.placeholder }]}>×</Text>
      </Pressable>
    </View>
  );
}

function MenuGlyph({
  kind,
  color,
  size,
}: {
  kind: "reply" | "copy" | "delete" | "select";
  color: string;
  size: number;
}) {
  if (kind === "reply") {
    return (
      <View style={{ width: size, height: size }}>
        <View style={[styles.replyStem, { borderColor: color }]} />
        <View style={[styles.replyHead, { borderRightColor: color }]} />
      </View>
    );
  }
  if (kind === "copy") {
    return (
      <View style={{ width: size, height: size }}>
        <View style={[styles.copyBack, { borderColor: color }]} />
        <View style={[styles.copyFront, { borderColor: color }]} />
      </View>
    );
  }
  if (kind === "select") {
    return (
      <View style={[styles.selectCircle, { width: size, height: size, borderColor: color }]}>
        <View style={[styles.selectTick, { borderColor: color }]} />
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.trashLid, { backgroundColor: color }]} />
      <View style={[styles.trashBody, { borderColor: color }]} />
    </View>
  );
}

const wallpaperMotifs = [
  { left: "6%", top: "7%", rotate: "12deg" },
  { left: "42%", top: "4%", rotate: "-18deg" },
  { left: "79%", top: "12%", rotate: "22deg" },
  { left: "20%", top: "25%", rotate: "-8deg" },
  { left: "63%", top: "31%", rotate: "14deg" },
  { left: "87%", top: "42%", rotate: "-21deg" },
  { left: "4%", top: "50%", rotate: "19deg" },
  { left: "39%", top: "57%", rotate: "-13deg" },
  { left: "72%", top: "66%", rotate: "9deg" },
  { left: "15%", top: "77%", rotate: "-24deg" },
  { left: "50%", top: "86%", rotate: "16deg" },
  { left: "84%", top: "91%", rotate: "-10deg" },
] as const;

/** Original vector-like wallpaper; no Telegram artwork is bundled or copied. */
function TelegramWallpaper({ dark }: { dark: boolean }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {wallpaperMotifs.map((motif, index) => (
        <View
          key={`${motif.left}-${motif.top}`}
          style={[
            styles.wallpaperMotif,
            {
              left: motif.left,
              top: motif.top,
              borderColor: dark ? "rgba(255,255,255,0.045)" : "rgba(76,101,105,0.10)",
              transform: [{ rotate: motif.rotate }],
            },
            index % 3 === 0 && styles.wallpaperMotifRound,
          ]}
        >
          <View
            style={[
              styles.wallpaperMotifDot,
              {
                backgroundColor: dark ? "rgba(255,255,255,0.045)" : "rgba(76,101,105,0.10)",
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  accessory: {
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  errorState: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorMessage: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 18,
  },
  retryLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 14,
    lineHeight: 18,
  },
  accessoryRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "stretch",
  },
  accessoryLine: {
    width: 3,
    borderRadius: 2,
  },
  accessoryCopy: {
    flex: 1,
    justifyContent: "center",
    gap: 1,
    paddingHorizontal: 8,
  },
  accessoryTitle: {
    fontFamily: fontFamily.semibold,
    fontSize: 13,
    lineHeight: 16,
  },
  accessoryText: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 17,
  },
  closeAccessory: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  closeAccessoryText: {
    fontFamily: fontFamily.regular,
    fontSize: 25,
    lineHeight: 27,
  },
  stopButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  stopGlyph: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: "#fff",
  },
  sendSlot: {
    width: 40,
    height: 40,
  },
  selectionToolbar: {
    position: "absolute",
    top: 8,
    left: 12,
    right: 12,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 8,
  },
  selectionAction: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
  },
  selectionCount: {
    fontFamily: fontFamily.semibold,
    fontSize: 15,
  },
  replyStem: {
    position: "absolute",
    left: 7,
    top: 7,
    width: 11,
    height: 9,
    borderTopWidth: 1.7,
    borderRightWidth: 1.7,
    borderTopRightRadius: 6,
  },
  replyHead: {
    position: "absolute",
    left: 2,
    top: 4,
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderRightWidth: 6,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
  },
  copyBack: {
    position: "absolute",
    left: 2,
    top: 2,
    width: 13,
    height: 13,
    borderWidth: 1.5,
    borderRadius: 3,
  },
  copyFront: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 13,
    height: 13,
    borderWidth: 1.5,
    borderRadius: 3,
  },
  selectCircle: {
    borderWidth: 1.5,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  selectTick: {
    width: 9,
    height: 5,
    borderLeftWidth: 1.5,
    borderBottomWidth: 1.5,
    transform: [{ rotate: "-45deg" }, { translateY: -1 }],
  },
  trashLid: {
    position: "absolute",
    top: 4,
    left: 3,
    width: 14,
    height: 1.5,
    borderRadius: 1,
  },
  trashBody: {
    position: "absolute",
    top: 7,
    left: 5,
    width: 10,
    height: 11,
    borderWidth: 1.5,
    borderTopWidth: 0,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  wallpaperMotif: {
    position: "absolute",
    width: 34,
    height: 24,
    borderWidth: 1.2,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  wallpaperMotifRound: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  wallpaperMotifDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});

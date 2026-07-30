import { PartRenderer } from "@/components/chat/PartRenderer";
import { StreamingIndicator } from "@/components/chat/StreamingIndicator";
import { BrainIcon, EyeOffIcon, StopCircleIcon, XIcon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Typography";
import { fontSize as fs, fontFamily, radius, useTheme, withOpacity } from "@/styles/theme";
import {
  Chat,
  type IMessage,
  type MessageMenuItem,
  type MessageTextProps,
  type PartialChatTheme,
  Send,
  type SendProps,
} from "../../../vendor/react-native-chat/src";
import { useHeaderHeight } from "@react-navigation/elements";
import { useFocusEffect } from "@react-navigation/native";
import type { AttachedQuote } from "@readany/core/types";
import type { CitationPart, MessageV2, QuotePart, TextPart } from "@readany/core/types/message";
import * as Clipboard from "expo-clipboard";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, type TextInput, TouchableOpacity, View } from "react-native";

const USER_ID = "narra-user";
const ASSISTANT_ID = "narra-ai";

type StreamingStep = "thinking" | "tool_calling" | "responding" | "idle";

interface NarraMessage extends IMessage {
  source: MessageV2;
}

interface NarraChatProps {
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
  autoFocus?: boolean;
}

function plainText(message: MessageV2): string {
  return message.parts
    .flatMap((part) => {
      if (part.type === "quote") return part.text ? [`> ${part.text}`] : [];
      if (part.type === "text") return part.text.trim() ? [part.text] : [];
      return [];
    })
    .join("\n\n");
}

function sortCitations(parts: MessageV2["parts"]): CitationPart[] {
  return parts
    .filter((part): part is CitationPart => part.type === "citation")
    .map((citation, order) => ({ citation, order }))
    .sort((a, b) => {
      const ai = a.citation.citationIndex;
      const bi = b.citation.citationIndex;
      if (typeof ai === "number" && typeof bi === "number") return ai - bi;
      if (typeof ai === "number") return -1;
      if (typeof bi === "number") return 1;
      return a.order - b.order;
    })
    .map(({ citation }) => citation);
}

function toChatMessage(message: MessageV2, streamingMessageId?: string): NarraMessage {
  return {
    _id: message.id,
    text: plainText(message),
    createdAt: message.createdAt,
    user: {
      _id: message.role === "user" ? USER_ID : ASSISTANT_ID,
      name: message.role === "user" ? "Вы" : "Narra AI",
    },
    system: message.role === "system",
    sent: message.role === "user",
    received: message.role !== "user",
    streaming: message.id === streamingMessageId,
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
  autoFocus = false,
}: NarraChatProps) {
  const { colors, isDark } = useTheme();
  const headerHeight = useHeaderHeight();
  const inputRef = useRef<TextInput>(null);
  const [deepThinking, setDeepThinking] = useState(false);
  const [spoilerFree, setSpoilerFree] = useState(false);

  const streamingMessageId =
    isStreaming && messages.at(-1)?.role === "assistant" ? messages.at(-1)?.id : undefined;
  const chatMessages = useMemo(
    () => messages.map((message) => toChatMessage(message, streamingMessageId)).reverse(),
    [messages, streamingMessageId],
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
      radii: {
        bubble: 18,
        bubbleGrouped: 6,
        inputField: 24,
        sendButton: 999,
        reaction: 14,
        dayPill: 14,
      },
      spacing: {
        screenEdge: 16,
        bubblePaddingH: 12,
        bubblePaddingV: 8,
        withinGroup: 2,
        betweenGroups: 8,
      },
      typography: {
        message: { fontSize: 16, lineHeight: 22, fontWeight: "400" },
        time: { fontSize: 11, fontWeight: "400" },
        senderName: { fontSize: 12, fontWeight: "600" },
        day: { fontSize: 12, fontWeight: "600" },
        system: { fontSize: 13, fontWeight: "400" },
      },
      composer: { minHeight: 48, maxHeight: 120, fieldPaddingH: 14, insetIconSize: 22 },
      sendButton: { size: 36 },
    }),
    [colors],
  );

  const handleSend = useCallback(
    (outgoing: NarraMessage[]) => {
      const text = outgoing[0]?.text?.trim() ?? "";
      if (!text && quotes.length === 0) return;
      void onSend(text, deepThinking, spoilerFree, quotes.length ? quotes : undefined);
      for (const quote of quotes) onRemoveQuote?.(quote.id);
      setDeepThinking(false);
      setSpoilerFree(false);
    },
    [deepThinking, onRemoveQuote, onSend, quotes, spoilerFree],
  );

  const messageActions = useCallback((message: NarraMessage): MessageMenuItem[] => {
    const text = plainText(message.source);
    if (!text) return [];
    return [
      {
        label: "Скопировать",
        onPress: () => void Clipboard.setStringAsync(text),
      },
    ];
  }, []);

  const renderMessageText = useCallback(
    ({ currentMessage, position }: MessageTextProps<NarraMessage>) => {
      const source = currentMessage.source;
      if (source.role === "user") {
        const quoteParts = source.parts.filter((part): part is QuotePart => part.type === "quote");
        const textParts = source.parts.filter((part): part is TextPart => part.type === "text");
        return (
          <View style={styles.messageContent}>
            {quoteParts.map((part) => (
              <View key={part.id} style={styles.quoteBlock}>
                <Text
                  style={[styles.quoteText, { color: colors.primaryForeground }]}
                  numberOfLines={4}
                >
                  {part.text}
                </Text>
                {part.source ? (
                  <Text
                    style={[
                      styles.quoteSource,
                      { color: withOpacity(colors.primaryForeground, 0.65) },
                    ]}
                  >
                    {part.source}
                  </Text>
                ) : null}
              </View>
            ))}
            {textParts.map((part) => (
              <Text
                key={part.id}
                style={[
                  styles.userText,
                  { color: position === "right" ? colors.primaryForeground : colors.foreground },
                ]}
              >
                {part.text}
              </Text>
            ))}
          </View>
        );
      }

      const citations = sortCitations(source.parts);
      return (
        <View style={styles.assistantContent}>
          {source.parts.map((part) => (
            <PartRenderer
              key={part.id}
              part={part}
              citations={citations}
              onCitationClick={onCitationClick}
            />
          ))}
        </View>
      );
    },
    [colors, onCitationClick],
  );

  const renderAccessory = useCallback(
    () => (
      <View style={styles.accessory}>
        {quotes.map((quote) => (
          <View key={quote.id} style={[styles.quoteChip, { backgroundColor: colors.elevation2 }]}>
            <Text style={[styles.chipText, { color: colors.foreground }]} numberOfLines={1}>
              {quote.text}
            </Text>
            <TouchableOpacity onPress={() => onRemoveQuote?.(quote.id)} hitSlop={8}>
              <XIcon size={12} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ))}
        <View style={styles.modeRow}>
          <ModeButton
            label="Глубокий анализ"
            active={deepThinking}
            onPress={() => setDeepThinking((value) => !value)}
            icon={
              <BrainIcon size={13} color={deepThinking ? colors.primary : colors.mutedForeground} />
            }
          />
          <ModeButton
            label="Без спойлеров"
            active={spoilerFree}
            onPress={() => setSpoilerFree((value) => !value)}
            icon={
              <EyeOffIcon size={13} color={spoilerFree ? colors.primary : colors.mutedForeground} />
            }
          />
        </View>
      </View>
    ),
    [colors, deepThinking, onRemoveQuote, quotes, spoilerFree],
  );

  const renderSend = useCallback(
    (props: SendProps<NarraMessage>) =>
      isStreaming ? (
        <TouchableOpacity
          style={[styles.stopButton, { backgroundColor: colors.elevation2 }]}
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel="Остановить ответ"
        >
          <StopCircleIcon size={20} color={colors.destructive} />
        </TouchableOpacity>
      ) : (
        <Send {...props} />
      ),
    [colors, isStreaming, onStop],
  );

  const showInitialStreaming =
    isStreaming &&
    currentStep !== "idle" &&
    (!messages.at(-1) ||
      messages.at(-1)?.role !== "assistant" ||
      messages.at(-1)?.parts.length === 0);

  return (
    <Chat<NarraMessage>
      messages={chatMessages}
      user={{ _id: USER_ID, name: "Вы" }}
      onSend={handleSend}
      locale="ru"
      colorScheme={isDark ? "dark" : "light"}
      theme={theme}
      darkTheme={theme}
      renderAvatar={null}
      renderMessageText={renderMessageText}
      renderAccessory={renderAccessory}
      renderSend={renderSend}
      renderChatFooter={
        showInitialStreaming ? () => <StreamingIndicator step={currentStep} /> : undefined
      }
      messageActions={messageActions}
      isDayAnimationEnabled
      isScrollToBottomEnabled
      textInputRef={inputRef}
      textInputProps={{
        placeholder,
        placeholderTextColor: colors.mutedForeground,
        editable: !isStreaming,
        multiline: true,
        style: { fontFamily: fontFamily.regular, fontSize: 16, color: colors.foreground },
        autoCapitalize: "sentences",
      }}
      keyboardAvoidingViewProps={{ keyboardVerticalOffset: headerHeight }}
      messagesContainerStyle={{ backgroundColor: colors.backgroundSecondary }}
      listProps={{
        keyboardDismissMode: "interactive",
        keyboardShouldPersistTaps: "handled",
      }}
    />
  );
}

function ModeButton({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.modeButton,
        {
          borderColor: active ? withOpacity(colors.primary, 0.5) : colors.border,
          backgroundColor: active ? withOpacity(colors.primary, 0.1) : "transparent",
        },
      ]}
      onPress={onPress}
    >
      {icon}
      <Text style={[styles.modeLabel, { color: active ? colors.primary : colors.mutedForeground }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  messageContent: {
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  assistantContent: {
    minWidth: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  userText: {
    fontFamily: fontFamily.regular,
    fontSize: 16,
    lineHeight: 22,
  },
  quoteBlock: {
    borderLeftWidth: 2,
    borderLeftColor: "rgba(255,255,255,0.5)",
    paddingLeft: 8,
  },
  quoteText: {
    fontFamily: fontFamily.regular,
    fontSize: fs.sm,
    lineHeight: 18,
  },
  quoteSource: {
    fontFamily: fontFamily.regular,
    fontSize: fs.xs,
    marginTop: 2,
  },
  accessory: {
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 2,
  },
  quoteChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.lg,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fs.xs,
  },
  modeRow: {
    flexDirection: "row",
    gap: 6,
  },
  modeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 0.5,
    borderRadius: radius.full,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  modeLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fs.xs,
  },
  stopButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});

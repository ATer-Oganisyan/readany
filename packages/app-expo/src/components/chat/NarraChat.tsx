import { fontFamily, useTheme, withOpacity } from "@/styles/theme";
import { spacingPixels } from "@deslop/primitives";
import { useHeaderHeight } from "@react-navigation/elements";
import { useFocusEffect } from "@react-navigation/native";
import type { AttachedQuote } from "@readany/core/types";
import type { CitationPart, MessageV2 } from "@readany/core/types/message";
import * as Clipboard from "expo-clipboard";
import type { TFunction } from "i18next";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, type TextInput, View } from "react-native";
import {
  Bubble,
  type BubbleProps,
  Chat,
  type IMessage,
  type InputToolbarProps,
  type MessageMenuItem,
  MessageText,
  type MessageTextProps,
  type PartialChatTheme,
} from "../../../vendor/react-native-chat/src";
import { NarraChatComposer } from "./narra-chat-composer";

const USER_ID = "narra-user";
const ASSISTANT_ID = "narra-ai";

type StreamingStep = "thinking" | "tool_calling" | "responding" | "idle";

interface NarraMessage extends IMessage {
  source: MessageV2;
}

interface AssistantMessageAction {
  label: string;
  onPress: (message: MessageV2) => void | Promise<void>;
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
  errorMessage?: string | null;
  retryLabel?: string;
  onRetry?: () => void | Promise<void>;
  autoFocus?: boolean;
  assistantName?: string;
  assistantAvatar?: IMessage["user"]["avatar"];
  adjustsForTransparentHeader?: boolean;
  floatingComposer?: boolean;
  showScrollToBottomButton?: boolean;
  showTypingIndicator?: boolean;
  revealMessageId?: string | null;
  onRevealComplete?: (messageId: string) => void;
  showModeControls?: boolean;
  assistantMessageAction?: AssistantMessageAction;
}

function messageText(message: MessageV2, t: TFunction): string {
  const body: string[] = [];
  const citations: CitationPart[] = [];

  for (const part of message.parts) {
    switch (part.type) {
      case "text":
        if (part.text.trim()) body.push(part.text);
        break;
      case "quote": {
        const source = part.source ? `\n> — ${part.source}` : "";
        body.push(`> ${part.text.replaceAll("\n", "\n> ")}${source}`);
        break;
      }
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
        body.push(`_${t("chat.responseStopped", "Ответ остановлен.")}_`);
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
    body.push(`**${t("chat.sources", "Источники")}**\n\n${sources.join("  \n")}`);
  }

  return body.join("\n\n");
}

function toChatMessage(
  message: MessageV2,
  assistantName: string,
  t: TFunction,
  assistantAvatar?: IMessage["user"]["avatar"],
  streamingMessageId?: string,
): NarraMessage {
  return {
    _id: message.id,
    text: messageText(message, t),
    createdAt: message.createdAt,
    user: {
      _id: message.role === "user" ? USER_ID : ASSISTANT_ID,
      name: message.role === "user" ? t("chat.roleUser", "Вы") : assistantName,
      avatar: message.role === "user" ? undefined : assistantAvatar,
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
  placeholder,
  quotes = [],
  onRemoveQuote,
  onCitationClick,
  onSend,
  onStop,
  errorMessage,
  retryLabel,
  onRetry,
  autoFocus = false,
  assistantName = "Narra AI",
  assistantAvatar,
  adjustsForTransparentHeader = false,
  floatingComposer = false,
  showScrollToBottomButton = true,
  showTypingIndicator = true,
  revealMessageId = null,
  onRevealComplete,
  showModeControls = true,
  assistantMessageAction,
}: NarraChatProps) {
  const { colors, isDark } = useTheme();
  const { t, i18n } = useTranslation();
  const effectivePlaceholder = placeholder || t("chat.inputPlaceholder", "Сообщение");
  const effectiveRetryLabel = retryLabel || t("common.retry", "Повторить");
  const headerHeight = useHeaderHeight();
  const inputRef = useRef<TextInput>(null);
  const [deepThinking, setDeepThinking] = useState(false);
  const [spoilerFree, setSpoilerFree] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);

  const streamingMessageId =
    isStreaming && messages.at(-1)?.role === "assistant" ? messages.at(-1)?.id : undefined;
  const chatMessages = useMemo(
    () =>
      messages
        .map((message) =>
          toChatMessage(message, assistantName, t, assistantAvatar, streamingMessageId),
        )
        .reverse(),
    [assistantAvatar, assistantName, messages, streamingMessageId, t],
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
        surface: colors.elevation2,
        surfaceOverlay: colors.primary10,
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

  const messageActions = useCallback(
    (message: NarraMessage): MessageMenuItem[] => {
      const text = messageText(message.source, t);
      const actions: MessageMenuItem[] = [];

      if (message.source.role === "assistant" && assistantMessageAction) {
        actions.push({
          label: assistantMessageAction.label,
          onPress: () => void assistantMessageAction.onPress(message.source),
        });
      }

      if (text) {
        actions.push({
          label: t("common.copy", "Скопировать"),
          onPress: () => void Clipboard.setStringAsync(text),
        });
      }

      return actions;
    },
    [assistantMessageAction, t],
  );

  const handleMessageLink = useCallback(
    (message: NarraMessage, url: string) => {
      if (!url.startsWith("narra-citation://")) return;
      const citationId = decodeURIComponent(url.slice("narra-citation://".length));
      const citation = message.source.parts.find(
        (part): part is CitationPart => part.type === "citation" && part.id === citationId,
      );
      if (citation) onCitationClick?.(citation);
    },
    [onCitationClick],
  );

  const renderMessageText = useCallback(
    (props: MessageTextProps<NarraMessage>) => {
      const shouldReveal =
        revealMessageId !== null &&
        String(props.currentMessage._id) === revealMessageId &&
        props.currentMessage.source.role === "assistant";

      return (
        <MessageText
          {...props}
          streamingReveal={shouldReveal}
          onStreamingRevealComplete={
            shouldReveal && onRevealComplete ? () => onRevealComplete(revealMessageId) : undefined
          }
        />
      );
    },
    [onRevealComplete, revealMessageId],
  );

  const renderBubble = useCallback(
    (props: BubbleProps<NarraMessage>) => (
      <Bubble
        {...props}
        bottomContainerStyle={{
          left: { display: "none" },
          right: { display: "none" },
        }}
        renderTicks={() => null}
      />
    ),
    [],
  );

  const messageTextProps = useMemo(
    () => ({
      containerStyle: {
        left: { margin: spacingPixels[12] },
        right: { margin: spacingPixels[12] },
      },
      markdown: true,
      onPress: handleMessageLink,
    }),
    [handleMessageLink],
  );

  const renderAccessory = useCallback(() => {
    if (!errorMessage && quotes.length === 0 && !showModeControls) return null;

    return (
      <View style={styles.accessory}>
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
              accessibilityLabel={effectiveRetryLabel}
              hitSlop={8}
            >
              <Text style={[styles.retryLabel, { color: colors.destructive }]}>
                {effectiveRetryLabel}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {quotes.map((quote) => (
          <View key={quote.id} style={[styles.quoteChip, { backgroundColor: colors.elevation2 }]}>
            <Text style={[styles.chipText, { color: colors.foreground }]} numberOfLines={1}>
              {quote.text}
            </Text>
            <Pressable onPress={() => onRemoveQuote?.(quote.id)} hitSlop={8}>
              <Text style={[styles.removeQuote, { color: colors.mutedForeground }]}>×</Text>
            </Pressable>
          </View>
        ))}
        {showModeControls ? (
          <View style={styles.modeRow}>
            <ModeButton
              label={t("chat.deepThinking", "Глубокий анализ")}
              active={deepThinking}
              onPress={() => setDeepThinking((value) => !value)}
            />
            <ModeButton
              label={t("chat.spoilerFree", "Без спойлеров")}
              active={spoilerFree}
              onPress={() => setSpoilerFree((value) => !value)}
            />
          </View>
        ) : null}
      </View>
    );
  }, [
    colors,
    deepThinking,
    errorMessage,
    onRemoveQuote,
    onRetry,
    quotes,
    effectiveRetryLabel,
    showModeControls,
    spoilerFree,
    t,
  ]);

  const renderInputToolbar = useCallback(
    (props: InputToolbarProps<NarraMessage>) => (
      <NarraChatComposer
        {...props}
        allowSendWithoutText={quotes.length > 0}
        floating={floatingComposer}
        isStreaming={isStreaming}
        onHeightChange={setComposerHeight}
        onStop={onStop}
      />
    ),
    [floatingComposer, isStreaming, onStop, quotes.length],
  );
  const renderNoTypingIndicator = useCallback(() => null, []);
  const renderTransparentHeaderInset = useCallback(
    () => <View pointerEvents="none" style={{ height: headerHeight + spacingPixels[8] }} />,
    [headerHeight],
  );

  const lastMessage = messages.at(-1);
  const showInitialStreaming =
    isStreaming &&
    currentStep !== "idle" &&
    (!lastMessage || lastMessage.role !== "assistant" || !messageText(lastMessage, t).trim());

  return (
    <Chat<NarraMessage>
      messages={chatMessages}
      user={{ _id: USER_ID, name: t("chat.roleUser", "Вы") }}
      onSend={handleSend}
      locale={i18n.resolvedLanguage === "en" ? "en" : "ru"}
      colorScheme={isDark ? "dark" : "light"}
      theme={theme}
      darkTheme={theme}
      renderAvatar={null}
      renderAccessory={renderAccessory}
      renderInputToolbar={renderInputToolbar}
      renderBubble={renderBubble}
      renderMessageText={renderMessageText}
      renderTime={() => null}
      renderTypingIndicator={showTypingIndicator ? undefined : renderNoTypingIndicator}
      isTyping={showTypingIndicator && showInitialStreaming}
      messageActions={messageActions}
      messageTextProps={messageTextProps}
      isDayAnimationEnabled
      isScrollToBottomEnabled={showScrollToBottomButton}
      textInputRef={inputRef}
      textInputProps={{
        placeholder: effectivePlaceholder,
        placeholderTextColor: colors.mutedForeground,
        editable: !isStreaming,
        multiline: true,
        style: { fontFamily: fontFamily.regular, fontSize: 16, color: colors.foreground },
        autoCapitalize: "sentences",
      }}
      keyboardAvoidingViewProps={{
        keyboardVerticalOffset: adjustsForTransparentHeader ? 0 : headerHeight,
      }}
      messagesContainerStyle={{ backgroundColor: colors.backgroundSecondary }}
      listProps={{
        automaticallyAdjustContentInsets: false,
        contentInsetAdjustmentBehavior: "never",
        keyboardDismissMode: "interactive",
        keyboardShouldPersistTaps: "handled",
        ...(adjustsForTransparentHeader
          ? { ListFooterComponent: renderTransparentHeaderInset }
          : {}),
        ...(floatingComposer
          ? {
              contentContainerStyle: {
                paddingBottom: spacingPixels[10],
                paddingTop: composerHeight,
              },
            }
          : {}),
      }}
    />
  );
}

function ModeButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={[
        styles.modeButton,
        {
          borderColor: active ? withOpacity(colors.primary, 0.5) : colors.border,
          backgroundColor: active ? withOpacity(colors.primary, 0.1) : "transparent",
        },
      ]}
      onPress={onPress}
    >
      <Text style={[styles.modeLabel, { color: active ? colors.primary : colors.mutedForeground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  accessory: {
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 2,
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
  quoteChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: 12,
  },
  removeQuote: {
    fontSize: 20,
    lineHeight: 20,
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
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  modeLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
  },
});

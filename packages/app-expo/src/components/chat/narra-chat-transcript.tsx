import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { Text } from "@/components/ui/Typography";
import { bodyTypography, fontFamily, useTheme, withOpacity } from "@/styles/theme";
import { spacingPixels } from "@deslop/primitives";
import type { CitationPart, MessageV2 } from "@readany/core/types/message";
import { LinearGradient } from "expo-linear-gradient";
import { Message, MessageScroller, Shimmer, useMessageScroller } from "panelui-native";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { StyleSheet, type TextStyle, View } from "react-native";

/**
 * Лента сообщений чата на MessageScroller из PanelUI.
 *
 * MessageScroller не навязывает формат сообщения — ему нужен только устойчивый
 * messageId, поэтому MessageV2 остаётся как есть. Открывается в конце, держит
 * позицию читателя, пока ответ дописывается ниже, и не сдвигает экран при
 * подгрузке истории сверху.
 *
 * Затухание краёв — рисованные градиенты из прозрачного цвета фона в
 * непрозрачный, сверху под навбаром и снизу над инпутом. Системный
 * ScrollViewMarker здесь не работает: он не находит прокрутку внутри
 * MessageScroller и роняет приложение («Failed to find ScrollView»).
 *
 * Пузыри красит тема PanelUI, собранная из токенов deslop
 * (src/panelui-theme.css): свои — primary, чужие — muted. Текст внутри рисует
 * наш MarkdownRenderer нашими шрифтами; на акцентном фоне он тёмный в обеих
 * темах, поэтому цвет передаётся по роли.
 */

/** Единый вертикальный ритм между навбаром, датой, сообщениями и инпутом. */
const ELEMENT_GAP = spacingPixels[12];
const ROW_HALF_GAP = ELEMENT_GAP / 2;
/** Высота затухания у краёв ленты совпадает с шагом вертикального ритма. */
const EDGE_FADE_HEIGHT = ELEMENT_GAP;
/** Даёт TextInput и FlatList закончить связанный пересчёт высоты после отправки. */
const FOLLOW_LAYOUT_SETTLE_MS = 80;
/** Повтор после первого окна виртуализации FlatList. */
const FOLLOW_LAYOUT_RETRY_MS = 140;
/** Геометрия сообщения по продуктовой спецификации чата. */
const MESSAGE_RADIUS = 20;
const MESSAGE_TEXT_STYLE: TextStyle = {
  ...bodyTypography,
  fontWeight: "400",
  lineHeight: bodyTypography.fontSize * 1.3,
};

/** Строка ленты: сообщение или разделитель дня. */
type ChatRow =
  | { kind: "day"; messageId: string; label: string }
  | { kind: "message"; messageId: string; message: MessageV2; scrollAnchor: boolean };

function dayLabel(timestamp: number, locale: "ru" | "en"): string {
  const value = new Date(timestamp);
  const today = new Date();
  const sameDay =
    value.getDate() === today.getDate() &&
    value.getMonth() === today.getMonth() &&
    value.getFullYear() === today.getFullYear();
  if (sameDay) return locale === "en" ? "Today" : "Сегодня";
  return value.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    ...(value.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

function buildRows(messages: MessageV2[], locale: "ru" | "en"): ChatRow[] {
  const rows: ChatRow[] = [];
  let lastDay = "";
  for (const message of messages) {
    const day = new Date(message.createdAt).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      rows.push({
        kind: "day",
        messageId: `day-${day}`,
        label: dayLabel(message.createdAt, locale),
      });
    }
    rows.push({ kind: "message", messageId: message.id, message, scrollAnchor: true });
  }
  return rows;
}

function citationsOf(message: MessageV2): CitationPart[] {
  return message.parts.filter((part): part is CitationPart => part.type === "citation");
}

/**
 * После собственной отправки всегда возвращает ленту к живому краю.
 *
 * Пока пользователь набирает многострочный текст, плавающий композер растёт и
 * уменьшает viewport. MessageScroller может принять это изменение геометрии за
 * ручную прокрутку от конца и перестать следовать за новыми строками. Короткое
 * ожидание перезапускается при изменении нижнего inset: FlatList сначала
 * принимает сообщение и окончательную высоту композера, а затем ставит готовую
 * ленту над полем. Обычная прокрутка чтения не затрагивается: эффект срабатывает
 * только при появлении нового пользовательского сообщения.
 */
function FollowSentMessage({
  bottomInset,
  messageId,
}: {
  bottomInset: number;
  messageId?: string;
}) {
  const { scrollToEnd, scrollToMessage } = useMessageScroller();
  const previousMessageId = useRef(messageId);
  const pendingFollow = useRef(false);

  useEffect(() => {
    const changed = previousMessageId.current !== messageId;
    previousMessageId.current = messageId;
    if (changed && messageId) pendingFollow.current = true;
    // В обычной колонке (без плавающего композера) MessageScroller сам ведёт
    // живой край; дополнительная синхронизация нужна только для overlay-инпута.
    if (!pendingFollow.current || bottomInset <= 0 || !messageId) return;
    const targetMessageId = messageId;

    let firstFrame = 0;
    let retryFrame = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const settleTimer = setTimeout(() => {
      firstFrame = requestAnimationFrame(() => {
        scrollToMessage(targetMessageId, false);
        // Первая команда монтирует целевую строку длинной виртуальной ленты.
        // После этого можно безопасно перейти к реальному нижнему краю: так
        // лента продолжит вести и следующий ответ, сохраняя 12pt до инпута.
        retryTimer = setTimeout(() => {
          retryFrame = requestAnimationFrame(() => {
            scrollToEnd(false);
            pendingFollow.current = false;
          });
        }, FOLLOW_LAYOUT_RETRY_MS);
      });
    }, FOLLOW_LAYOUT_SETTLE_MS);

    return () => {
      clearTimeout(settleTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (firstFrame) cancelAnimationFrame(firstFrame);
      if (retryFrame) cancelAnimationFrame(retryFrame);
    };
  }, [bottomInset, messageId, scrollToEnd, scrollToMessage]);

  return null;
}

/**
 * После первого измерения плавающего композера повторно фиксирует живой край.
 *
 * На первом кадре его высота ещё равна нулю, поэтому MessageScroller успевает
 * открыть ленту без нижнего резервирования. Когда onLayout сообщает реальную
 * высоту, FlatList уже считает начальную прокрутку завершённой и оставляет
 * последнее сообщение под инпутом. Один повтор после применения inset
 * исправляет только стартовую геометрию и не мешает ручному чтению истории.
 */
function SyncInitialComposerInset({ bottomInset }: { bottomInset: number }) {
  const { scrollToEnd } = useMessageScroller();
  const previousBottomInset = useRef(bottomInset);
  const didSync = useRef(bottomInset > 0);

  useEffect(() => {
    const hadNoInset = previousBottomInset.current <= 0;
    previousBottomInset.current = bottomInset;
    if (didSync.current || !hadNoInset || bottomInset <= 0) return;
    didSync.current = true;

    let frame = 0;
    const settleTimer = setTimeout(() => {
      frame = requestAnimationFrame(() => scrollToEnd(false));
    }, FOLLOW_LAYOUT_SETTLE_MS);

    return () => {
      clearTimeout(settleTimer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [bottomInset, scrollToEnd]);

  return null;
}

interface NarraChatTranscriptProps {
  messages: MessageV2[];
  locale: "ru" | "en";
  /** Текст сообщения, собранный вызывающей стороной из частей MessageV2. */
  renderText: (message: MessageV2) => string;
  streamingMessageId?: string;
  onCitationClick?: (citation: CitationPart) => void;
  /**
   * Высота прозрачного навбара, под который уходит лента. Эта зона закрашена
   * фоном и переходит в градиент — содержимое растворяется, а не обрезается.
   */
  topInset?: number;
  /** Высота плавающего инпута, под которым продолжается лента. */
  bottomInset?: number;
  /** Кнопка возврата к последнему сообщению. */
  showScrollToBottom?: boolean;
  /** Пузырь «печатает» в конце ленты, пока ответа ещё нет. */
  showTyping?: boolean;
}

export function NarraChatTranscript({
  messages,
  locale,
  renderText,
  streamingMessageId,
  onCitationClick,
  topInset = 0,
  bottomInset = 0,
  showScrollToBottom = true,
  showTyping = false,
}: NarraChatTranscriptProps) {
  const { colors } = useTheme();
  const typingLabel = locale === "en" ? "Typing…" : "Печатает…";
  const rows = useMemo(() => buildRows(messages, locale), [locale, messages]);
  const latestUserMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") return messages[index]?.id;
    }
    return undefined;
  }, [messages]);
  const fadeColor = colors.background;

  const renderRow = useCallback(
    ({ item }: { item: ChatRow }) => {
      if (item.kind === "day") {
        return (
          <View style={styles.dayRow}>
            <View style={[styles.dayPill, { backgroundColor: colors.elevation1 }]}>
              <Text style={[styles.dayLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
            </View>
          </View>
        );
      }

      const isUser = item.message.role === "user";
      return (
        <View style={styles.messageRow}>
          <Message align={isUser ? "end" : "start"}>
            <Message.Content>
              <Message.Bubble
                className="rounded-es-[20px] rounded-ee-[20px]"
                style={styles.messageBubble}
              >
                <MarkdownRenderer
                  citations={citationsOf(item.message)}
                  content={renderText(item.message)}
                  isStreaming={item.message.id === streamingMessageId}
                  onCitationClick={onCitationClick}
                  textColor={isUser ? colors.primaryForeground : colors.foreground}
                  textStyle={MESSAGE_TEXT_STYLE}
                  trimTrailingParagraphSpacing
                />
              </Message.Bubble>
            </Message.Content>
          </Message>
        </View>
      );
    },
    [colors, onCitationClick, renderText, streamingMessageId],
  );

  return (
    <View style={styles.host}>
      <MessageScroller autoScroll defaultScrollPosition="end" style={styles.host}>
        <MessageScroller.List
          automaticallyAdjustKeyboardInsets
          contentContainerClassName="grow justify-end gap-0 p-0"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "flex-end",
            paddingTop: topInset + ROW_HALF_GAP,
            paddingBottom: 0,
          }}
          data={rows}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={<View style={{ height: bottomInset + ROW_HALF_GAP }} />}
          renderItem={renderRow}
        />
        <SyncInitialComposerInset bottomInset={bottomInset} />
        <FollowSentMessage bottomInset={bottomInset} messageId={latestUserMessageId} />
        {showTyping ? (
          <View style={styles.messageRow}>
            <Message align="start">
              <Message.Content>
                <Message.Bubble
                  className="rounded-es-[20px] rounded-ee-[20px]"
                  style={styles.messageBubble}
                >
                  <Shimmer>{typingLabel}</Shimmer>
                </Message.Bubble>
              </Message.Content>
            </Message>
          </View>
        ) : null}
        {showScrollToBottom ? <MessageScroller.Button /> : null}
      </MessageScroller>

      {/* Оба края — один непрерывный линейный переход на всю высоту зоны:
          у навбара 100→0%, у инпута 0→100%. */}
      <LinearGradient
        colors={[fadeColor, withOpacity(fadeColor, 0)]}
        end={{ x: 0.5, y: 1 }}
        locations={[0, 1]}
        pointerEvents="none"
        start={{ x: 0.5, y: 0 }}
        style={[styles.topOverlay, { height: topInset + EDGE_FADE_HEIGHT }]}
      />
      <LinearGradient
        colors={[withOpacity(fadeColor, 0), fadeColor]}
        end={{ x: 0.5, y: 1 }}
        locations={[0, 1]}
        pointerEvents="none"
        start={{ x: 0.5, y: 0 }}
        style={[styles.bottomOverlay, { height: bottomInset + EDGE_FADE_HEIGHT }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  messageRow: { paddingHorizontal: spacingPixels[16], paddingVertical: ROW_HALF_GAP },
  messageBubble: { borderCurve: "continuous", borderRadius: MESSAGE_RADIUS },
  dayRow: { alignItems: "center", paddingVertical: ROW_HALF_GAP },
  dayPill: {
    borderRadius: 999,
    paddingHorizontal: spacingPixels[10],
    paddingVertical: spacingPixels[3],
  },
  dayLabel: { fontFamily: fontFamily.regular, fontSize: 13 },
  topOverlay: { position: "absolute", top: 0, left: 0, right: 0 },
  bottomOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
});

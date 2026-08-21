import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { Text } from "@/components/ui/Typography";
import { bodyTypography, fontFamily, useTheme, withOpacity } from "@/styles/theme";
import { spacingPixels } from "@deslop/primitives";
import type { CitationPart, MessageV2 } from "@readany/core/types/message";
import { LinearGradient } from "expo-linear-gradient";
import {
  Message,
  MessageScroller,
  Shimmer,
  useMessageScroller,
} from "panelui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { type ScrollViewProps, StyleSheet, type TextStyle, View } from "react-native";
import type { KeyboardChatScrollViewRef } from "react-native-keyboard-controller";
import { NarraKeyboardChatScrollView } from "./narra-keyboard-chat-scroll-view";
import { StreamingWords } from "./streaming-words";

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
/** Пустое множество для стартового состояния: новая ссылка каждый рендер сбивала бы мемоизацию. */
const EMPTY_IDS: ReadonlySet<string> = new Set();
/** Насколько далеко от живого края слежение за ответом ещё уместно. */
const NEAR_LIVE_EDGE = 160;
/** Геометрия сообщения по продуктовой спецификации чата. */
const MESSAGE_RADIUS = 20;
/**
 * Разметка в ещё не дописанном ответе.
 *
 * Пословное появление раскладывает строку на отдельные слова, и инлайновая
 * разметка на этом рвётся. Пока ответ идёт с разметкой — показываем его обычным
 * рендером, без волны: это ровно то поведение, что было до неё.
 */
const MARKDOWN_SYNTAX = /[*_`#>|]|\[\d*\]|^\s*[-+]\s|^\s*\d+\.\s/m;

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
  chatScrollViewRef,
  messageId,
}: {
  bottomInset: number;
  chatScrollViewRef: MutableRefObject<KeyboardChatScrollViewRef | null>;
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
            chatScrollViewRef.current?.scrollToEnd({ animated: false });
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
  }, [bottomInset, chatScrollViewRef, messageId, scrollToEnd, scrollToMessage]);

  return null;
}

/**
 * После первого измерения плавающего композера подтверждает живой край.
 *
 * Лента открывается по стартовой оценке дока (COLLAPSED_COMPOSER_DOCK_HEIGHT),
 * поэтому последнее сообщение сразу стоит над инпутом. Когда onLayout сообщает
 * настоящую высоту, FlatList уже считает начальную прокрутку завершённой —
 * один доскролл добирает расхождение оценки с измерением. При точной оценке он
 * ничего не двигает, поэтому скачка на открытии больше нет.
 */
function SyncInitialComposerInset({
  bottomInset,
  chatScrollViewRef,
  composerMeasured,
}: {
  bottomInset: number;
  chatScrollViewRef: MutableRefObject<KeyboardChatScrollViewRef | null>;
  composerMeasured: boolean;
}) {
  const { scrollToEnd } = useMessageScroller();
  const didSync = useRef(false);

  useEffect(() => {
    if (didSync.current || !composerMeasured || bottomInset <= 0) return;
    didSync.current = true;

    let frame = 0;
    const settleTimer = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        scrollToEnd(false);
        chatScrollViewRef.current?.scrollToEnd({ animated: false });
      });
    }, FOLLOW_LAYOUT_SETTLE_MS);

    return () => {
      clearTimeout(settleTimer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [bottomInset, chatScrollViewRef, composerMeasured, scrollToEnd]);

  return null;
}

/**
 * Удерживает последнее сообщение над многострочным плавающим композером.
 *
 * Нижний padding ленты растёт вместе с TextInput. VirtualizedList обновляет
 * диапазон прокрутки, но не сохраняет экранный якорь, поэтому компенсируем
 * ровно дельту высоты после layout. Это не ведёт пользователя в конец чата и
 * не мешает чтению истории: видимые сообщения просто остаются над инпутом.
 */
function FollowComposerResize({
  baseBottomInset,
  bottomInset,
  chatScrollViewRef,
  composerMeasured,
  scrollOffsetRef,
}: {
  baseBottomInset: number;
  bottomInset: number;
  chatScrollViewRef: MutableRefObject<KeyboardChatScrollViewRef | null>;
  composerMeasured: boolean;
  scrollOffsetRef: MutableRefObject<number>;
}) {
  const previousBottomInset = useRef(bottomInset);
  const previousMeasured = useRef(composerMeasured);

  useEffect(() => {
    const previous = previousBottomInset.current;
    const wasMeasured = previousMeasured.current;
    previousBottomInset.current = bottomInset;
    previousMeasured.current = composerMeasured;
    // Переход «стартовая оценка → измерение» не пользовательский ресайз:
    // стартовую геометрию доводит SyncInitialComposerInset.
    if (!wasMeasured && composerMeasured) return;
    if (baseBottomInset <= 0 || previous <= 0 || previous === bottomInset) return;
    const delta = bottomInset - previous;

    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        chatScrollViewRef.current?.scrollTo({
          animated: false,
          y: scrollOffsetRef.current + delta,
        });
      });
    });

    return () => {
      if (firstFrame) cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [baseBottomInset, bottomInset, chatScrollViewRef, composerMeasured, scrollOffsetRef]);

  return null;
}

/**
 * Ведёт живой край, пока ответ печатается.
 *
 * `FollowSentMessage` реагирует только на новое сообщение пользователя, а
 * растущий ответ ассистента менял лишь высоту контента. MessageScroller
 * догоняет её сам только когда считает себя у края, и после программной
 * прокрутки это состояние не восстанавливалось — ответ уползал под инпут.
 * Условие — не «идёт стрим», а «хвост ленты изменился»: в чате персонажа ответ
 * приходит целиком, без токенов, поэтому привязка к streamingMessageId там
 * молчала и готовый ответ вставал под инпут. Подтягиваем край, лишь пока
 * читатель действительно стоит внизу: чтение истории эффект не прерывает.
 */
function FollowLiveEdge({
  bottomInset,
  chatScrollViewRef,
  distanceFromBottomRef,
  tailId,
  tailLength,
}: {
  bottomInset: number;
  chatScrollViewRef: MutableRefObject<KeyboardChatScrollViewRef | null>;
  distanceFromBottomRef: MutableRefObject<number>;
  tailId?: string;
  tailLength: number;
}) {
  const { scrollToEnd } = useMessageScroller();

  useEffect(() => {
    // Длина последнего сообщения здесь и условие, и тик: каждый пришедший
    // фрагмент — как и разом вставленный ответ — меняет её и заново догоняет край.
    if (!tailId || tailLength <= 0 || bottomInset <= 0) return;
    // Читатель ушёл в историю — не выдёргиваем его к живому краю.
    if (distanceFromBottomRef.current > NEAR_LIVE_EDGE) return;

    const frame = requestAnimationFrame(() => {
      scrollToEnd(false);
      chatScrollViewRef.current?.scrollToEnd({ animated: false });
    });

    return () => cancelAnimationFrame(frame);
  }, [bottomInset, chatScrollViewRef, distanceFromBottomRef, scrollToEnd, tailId, tailLength]);

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
  /** Базовая высота однострочного композера, зарезервированная в содержимом списка. */
  baseBottomInset?: number;
  composerMeasured?: boolean;
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
  baseBottomInset = 0,
  composerMeasured = false,
  showScrollToBottom = true,
  showTyping = false,
}: NarraChatTranscriptProps) {
  const { colors, isDark } = useTheme();
  const typingLabel = locale === "en" ? "Typing…" : "Печатает…";
  const rows = useMemo(() => buildRows(messages, locale), [locale, messages]);
  const latestUserMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") return messages[index]?.id;
    }
    return undefined;
  }, [messages]);
  // Ответы, пришедшие при открытом чате: их проявляем по словам. История,
  // с которой чат открылся, появляется сразу — иначе каждое открытие
  // превращалось бы в представление.
  const [revealIds, setRevealIds] = useState<ReadonlySet<string>>(EMPTY_IDS);
  const seenIdsRef = useRef<Set<string> | null>(null);
  const tailMessage = messages.at(-1);
  const tailId = tailMessage?.id;
  const tailLength = useMemo(
    () => (tailMessage ? renderText(tailMessage).length : 0),
    [renderText, tailMessage],
  );
  useEffect(() => {
    if (!seenIdsRef.current) {
      seenIdsRef.current = new Set(messages.map((message) => message.id));
      return;
    }
    const tail = messages.at(-1);
    if (!tail || tail.role !== "assistant" || seenIdsRef.current.has(tail.id)) return;
    seenIdsRef.current.add(tail.id);
    // Текст, который дописывается по токенам, ведёт себя иначе: там волну
    // задаёт сам поток, и целое сообщение проявлять не нужно.
    if (tail.id === streamingMessageId) return;
    setRevealIds((previous) => new Set(previous).add(tail.id));
  }, [messages, streamingMessageId]);

  const fadeColor = colors.background;
  const chatScrollViewRef = useRef<KeyboardChatScrollViewRef>(null);
  const scrollOffsetRef = useRef(0);
  const distanceFromBottomRef = useRef(0);
  const renderScrollComponent = useCallback(
    (props: ScrollViewProps) => (
      <NarraKeyboardChatScrollView
        {...props}
        chatScrollViewRef={chatScrollViewRef}
        distanceFromBottomRef={distanceFromBottomRef}
        scrollOffsetRef={scrollOffsetRef}
      />
    ),
    [],
  );

  const renderRow = useCallback(
    ({ item }: { item: ChatRow }) => {
      if (item.kind === "day") {
        return (
          <View style={styles.dayRow}>
            {/* Плашка даты держится на фоне входящего бабла: в светлой теме это
                bg-muted из panelui, в тёмной — тот же Primary 10, что и у бабла. */}
            <View
              style={[
                styles.dayPill,
                { backgroundColor: isDark ? colors.primary10 : colors.muted },
              ]}
            >
              <Text style={[styles.dayLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
            </View>
          </View>
        );
      }

      const isUser = item.message.role === "user";
      const messageBody = renderText(item.message);
      const isStreamingMessage = item.message.id === streamingMessageId;
      // Волна только на живом ответе героя: свои сообщения появляются целиком,
      // а дописанный ответ отдаётся обычному рендеру — с разметкой и сносками.
      const revealWhole = revealIds.has(item.message.id);
      const revealWords =
        (isStreamingMessage || revealWhole) && !isUser && !MARKDOWN_SYNTAX.test(messageBody);
      return (
        <View style={styles.messageRow}>
          <Message align={isUser ? "end" : "start"}>
            <Message.Content>
              <Message.Bubble
                className="rounded-es-[20px] rounded-ee-[20px]"
                style={[
                  styles.messageBubble,
                  // В тёмной теме входящий бабл держится на Primary 10, иначе он
                  // сливается с приподнятой поверхностью шторки.
                  !isUser && isDark ? { backgroundColor: colors.primary10 } : undefined,
                ]}
              >
                {revealWords ? (
                  <StreamingWords
                    color={colors.foreground}
                    mode={isStreamingMessage ? "stream" : "whole"}
                    text={messageBody}
                    textStyle={MESSAGE_TEXT_STYLE}
                  />
                ) : (
                  <MarkdownRenderer
                    citations={citationsOf(item.message)}
                    content={messageBody}
                    isStreaming={isStreamingMessage}
                    onCitationClick={onCitationClick}
                    textColor={isUser ? colors.primaryForeground : colors.foreground}
                    textStyle={MESSAGE_TEXT_STYLE}
                    trimTrailingParagraphSpacing
                  />
                )}
              </Message.Bubble>
            </Message.Content>
          </Message>
        </View>
      );
    },
    [colors, isDark, onCitationClick, renderText, revealIds, streamingMessageId],
  );

  return (
    <View style={styles.host}>
      <MessageScroller autoScroll defaultScrollPosition="end" style={styles.host}>
        <MessageScroller.List
          alwaysBounceVertical={false}
          automaticallyAdjustContentInsets={false}
          automaticallyAdjustKeyboardInsets={false}
          contentContainerClassName="grow justify-end gap-0 p-0"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "flex-end",
            paddingTop: topInset + ROW_HALF_GAP,
            paddingBottom: bottomInset + ROW_HALF_GAP,
          }}
          data={rows}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          renderItem={renderRow}
          renderScrollComponent={renderScrollComponent}
        />
        <SyncInitialComposerInset
          bottomInset={baseBottomInset}
          chatScrollViewRef={chatScrollViewRef}
          composerMeasured={composerMeasured}
        />
        <FollowComposerResize
          baseBottomInset={baseBottomInset}
          bottomInset={bottomInset}
          chatScrollViewRef={chatScrollViewRef}
          composerMeasured={composerMeasured}
          scrollOffsetRef={scrollOffsetRef}
        />
        <FollowSentMessage
          bottomInset={baseBottomInset}
          chatScrollViewRef={chatScrollViewRef}
          messageId={latestUserMessageId}
        />
        <FollowLiveEdge
          bottomInset={baseBottomInset}
          chatScrollViewRef={chatScrollViewRef}
          distanceFromBottomRef={distanceFromBottomRef}
          tailId={tailId}
          tailLength={tailLength}
        />
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
        {showScrollToBottom ? (
          <MessageScroller.Button
            onTouchEnd={() => chatScrollViewRef.current?.scrollToEnd({ animated: true })}
          />
        ) : null}
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

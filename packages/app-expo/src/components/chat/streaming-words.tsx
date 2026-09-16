import type { CitationPart } from "@readany/core/types/message";
import type { TextStyle } from "react-native";
import { StyleSheet, Text, View } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

/**
 * Пословное появление ответа модели.
 *
 * Настройки взяты из StreamingText в deslop/mini-app (mode="word",
 * speed="normal"): шаг между словами 35 мс, слово всплывает 400 мс —
 * прозрачность плюс подъём на 6 pt, кривая ease-out (0.23, 1, 0.32, 1).
 *
 * Нара и персонажи передают готовый ответ, поэтому очередь слов одинакова.
 */

/** Шаг между словами (SPEED_PRESETS.normal). */
const WORD_STAGGER_MS = 35;
/** Длительность появления одного слова. */
const WORD_DURATION_MS = 400;
/** Подъём слова из-под строки. */
const WORD_OFFSET = 6;
/** Сокращённое движение: остаётся только проявление. */
const REDUCED_DURATION_MS = 150;
/**
 * Сколько всего длится волна, когда ответ пришёл целиком.
 *
 * У персонажей ответ не печатается по токенам — он вставляется разом, и очередь
 * слов задавать нечему. Тогда волну ведём по всему сообщению, а шаг сжимаем,
 * чтобы длинный ответ не проявлялся полминуты.
 */
const WHOLE_MESSAGE_STAGGER_MS = 2100;

const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

const WORD_KEYFRAMES = {
  from: { opacity: 0, transform: [{ translateY: WORD_OFFSET }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};

const REDUCED_KEYFRAMES = {
  from: { opacity: 0 },
  to: { opacity: 1 },
};

interface StreamingWordsProps {
  text: string;
  /** Типографика бабла: слова садятся на ту же сетку, что обычный текст. */
  textStyle?: TextStyle;
  color: string;
  /** Новые ответы появляются по словам; история и сообщения читателя — сразу. */
  animate?: boolean;
  citations?: CitationPart[];
  onCitationClick?: (citation: CitationPart) => void;
}

/**
 * Пробелы не анимируются (как в исходнике) и склеиваются со словом: перенос
 * строк здесь делает раскладка, а не текстовый движок, поэтому отдельный
 * пробельный узел терялся бы на переносе.
 */
function splitLines(text: string): string[][] {
  return text.split("\n").map((line) => line.split(/\s+/).filter(Boolean));
}

export function StreamingWords({
  text,
  textStyle,
  color,
  animate = true,
  citations = [],
  onCitationClick,
}: StreamingWordsProps) {
  const reducedMotion = useReducedMotion();
  const lines = splitLines(text);
  const total = lines.reduce((sum, words) => sum + words.length, 0);

  const citationPress = (word: string) => {
    const match = word.match(/^\[(\d+)\]/);
    if (!match || !onCitationClick) return undefined;
    const number = Number(match[1]);
    const citation =
      citations.find((item) => item.citationIndex === number) ?? citations[number - 1];
    return citation ? () => onCitationClick(citation) : undefined;
  };

  if (!animate) {
    return (
      <Text selectable style={[textStyle, { color }]}>
        {text.split(/(\[\d+\])/).map((part, index) => {
          const onPress = citationPress(part);
          return onPress ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: части статичного текста идут по порядку
            <Text key={index} onPress={onPress}>
              {part}
            </Text>
          ) : (
            part
          );
        })}
      </Text>
    );
  }

  const step = Math.min(WORD_STAGGER_MS, WHOLE_MESSAGE_STAGGER_MS / Math.max(total, 1));

  let wordIndex = 0;

  return (
    <View>
      {lines.map((words, lineIndex) => {
        const lineKey = `line-${lineIndex}`;
        return (
          <View key={lineKey} style={styles.line}>
            {words.map((word, indexInLine) => {
              const delay = wordIndex * step;
              wordIndex += 1;
              return (
                <Animated.Text
                  // biome-ignore lint/suspicious/noArrayIndexKey: позиция слова в готовом ответе стабильна
                  key={`${lineKey}-${indexInLine}`}
                  onPress={citationPress(word)}
                  style={[
                    textStyle,
                    { color },
                    {
                      // Native CSS animation attaches after the view mounts.
                      // Keep that first frame hidden until keyframes take over.
                      opacity: 0,
                      animationName: reducedMotion ? REDUCED_KEYFRAMES : WORD_KEYFRAMES,
                      animationDuration: reducedMotion ? REDUCED_DURATION_MS : WORD_DURATION_MS,
                      animationTimingFunction: reducedMotion ? "linear" : EASE_OUT,
                      animationDelay: reducedMotion ? 0 : delay,
                      animationFillMode: "both",
                    },
                  ]}
                >
                  {`${word} `}
                </Animated.Text>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
});

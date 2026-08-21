import { useEffect, useRef } from "react";
import type { TextStyle } from "react-native";
import { StyleSheet, View } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

/**
 * Пословное появление ответа модели.
 *
 * Настройки взяты из StreamingText в deslop/mini-app (mode="word",
 * speed="normal"): шаг между словами 35 мс, слово всплывает 400 мс —
 * прозрачность плюс подъём на 6 pt, кривая ease-out (0.23, 1, 0.32, 1).
 *
 * В вебе волну задаёт staggerChildren по готовому тексту. Здесь текст приходит
 * потоком, поэтому очередь слов задаёт сам поток: анимируется только новая
 * порция, а шаг нужен внутри неё — когда в одном чанке пришло несколько слов.
 * Появление слова — это анимация его монтирования, так что уже показанные слова
 * при следующем чанке не переигрываются.
 */

/** Шаг между словами внутри одной порции (SPEED_PRESETS.normal). */
const WORD_STAGGER_MS = 35;
/** Длительность появления одного слова. */
const WORD_DURATION_MS = 400;
/** Подъём слова из-под строки. */
const WORD_OFFSET = 6;
/** Сокращённое движение: остаётся только проявление. */
const REDUCED_DURATION_MS = 150;
/**
 * Предел шага внутри порции.
 *
 * Обычный чанк потока — несколько слов, и до предела дело не доходит. Но если
 * порция пришла большой (например, история открылась разом), без предела
 * последние слова ждали бы секунды.
 */
const MAX_STAGGER_WORDS = 12;

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
}

/**
 * Пробелы не анимируются (как в исходнике) и склеиваются со словом: перенос
 * строк здесь делает раскладка, а не текстовый движок, поэтому отдельный
 * пробельный узел терялся бы на переносе.
 */
function splitLines(text: string): string[][] {
  return text.split("\n").map((line) => line.split(/\s+/).filter(Boolean));
}

export function StreamingWords({ text, textStyle, color }: StreamingWordsProps) {
  const reducedMotion = useReducedMotion();
  const lines = splitLines(text);
  const total = lines.reduce((sum, words) => sum + words.length, 0);

  // Сколько слов было показано до этого рендера: всё, что дальше, — новая
  // порция, и только она получает шаг. Значение обновляется после коммита,
  // поэтому во время рендера здесь именно прошлое состояние.
  const shownRef = useRef(0);
  const shown = shownRef.current;
  useEffect(() => {
    shownRef.current = total;
  }, [total]);

  let wordIndex = 0;

  return (
    <View>
      {lines.map((words, lineIndex) => {
        const lineKey = `line-${lineIndex}`;
        return (
          <View key={lineKey} style={styles.line}>
            {words.map((word, indexInLine) => {
              const staggerSteps = Math.min(Math.max(wordIndex - shown, 0), MAX_STAGGER_WORDS);
              wordIndex += 1;
              return (
                <Animated.Text
                  // Последнее слово потока дописывается по буквам, поэтому ключ с текстом
                  // переигрывал бы его появление на каждом токене: нужен ключ по позиции.
                  // biome-ignore lint/suspicious/noArrayIndexKey: позиция здесь и есть личность слова
                  key={`${lineKey}-${indexInLine}`}
                  style={[
                    textStyle,
                    { color },
                    {
                      animationName: reducedMotion ? REDUCED_KEYFRAMES : WORD_KEYFRAMES,
                      animationDuration: reducedMotion ? REDUCED_DURATION_MS : WORD_DURATION_MS,
                      animationTimingFunction: reducedMotion ? "linear" : EASE_OUT,
                      animationDelay: reducedMotion ? 0 : staggerSteps * WORD_STAGGER_MS,
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

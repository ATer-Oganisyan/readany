import { MishanaerIcon } from "@/components/ui/MishanaerIcon";
import { useTheme } from "@/styles/theme";
import { radiusPixels, spacingPixels } from "@deslop/primitives";
import { AIInput } from "panelui-native";
import type { ComponentPropsWithRef } from "react";
import { useCallback } from "react";
import { Pressable, StyleSheet, type TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { IMessage, InputToolbarProps } from "../../../vendor/react-native-chat/src";

/**
 * Поле ввода чата на AIInput из PanelUI.
 *
 * Контракт с вендорной лентой сохранён: она по-прежнему отдаёт текст, коллбэк
 * изменения и отправку через InputToolbarProps, поэтому заменён только инпут,
 * а сама лента пока прежняя.
 *
 * Контролы включены в системном виде (native): их цвет, метрики и форму
 * задаёт платформа — на iOS 26 это Liquid Glass. Тема PanelUI до них не
 * дотягивается, и это нужное поведение: пока своя тема не собрана, инпут
 * должен выглядеть системным, а не чужим.
 */
type RuntimeToolbarProps<TMessage extends IMessage> = InputToolbarProps<TMessage> & {
  allowSendWithoutText?: boolean;
  isStreaming?: boolean;
  onSend?: (
    message: Partial<TMessage> | Partial<TMessage>[],
    shouldResetInputToolbar: boolean,
  ) => void;
  onStop?: () => void;
  textInputProps?: ComponentPropsWithRef<typeof TextInput>;
};

export function NarraChatComposer<TMessage extends IMessage>({
  allowSendWithoutText = false,
  isStreaming = false,
  onStop,
  ...props
}: RuntimeToolbarProps<TMessage>) {
  const { colors } = useTheme();
  const { bottom: safeAreaBottom } = useSafeAreaInsets();
  const text = props.text ?? "";
  const inputProps = props.textInputProps;
  const onSend = props.onSend;

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed && !allowSendWithoutText) return;
      onSend?.({ text: trimmed } as Partial<TMessage>, true);
    },
    [allowSendWithoutText, onSend],
  );

  const canPress = isStreaming ? Boolean(onStop) : text.trim().length > 0 || allowSendWithoutText;
  const sendLabel = isStreaming ? "Остановить" : "Отправить";
  const handlePress = useCallback(() => {
    if (isStreaming) {
      onStop?.();
      return;
    }
    handleSubmit(text);
  }, [handleSubmit, isStreaming, onStop, text]);

  return (
    // KeyboardStickyView снаружи двигает весь композер синхронно с клавиатурой.
    // Здесь остаются только постоянные safe-area и дизайн-зазор; высота клавиатуры
    // больше не вычисляется и не применяется второй раз внутри AIInput.
    <View
      style={[
        styles.container,
        {
          paddingBottom: KEYBOARD_GAP + safeAreaBottom,
        },
      ]}
    >
      <AIInput
        avoidKeyboard={false}
        native
        onStop={onStop}
        onSubmit={handleSubmit}
        onValueChange={inputProps?.onChangeText}
        status={isStreaming ? "streaming" : "ready"}
        style={[styles.input, { borderColor: colors.primary5 }]}
        value={text}
      >
        {/* Сам TextInput остаётся многострочным и растёт вместе с текстом. */}
        <AIInput.Row style={styles.row}>
          {/* Метрики строки считает сам AIInput: он центрирует одну строку в
              контроле и растит поле вниз. Свои minHeight и паддинги перебивали
              этот расчёт и сдвигали плейсхолдер вверх. */}
          <AIInput.Field
            accessibilityLabel={inputProps?.placeholder}
            autoFocus={inputProps?.autoFocus}
            editable={inputProps?.editable}
            nativeID={inputProps?.nativeID}
            placeholder={inputProps?.placeholder ?? ""}
            style={styles.field}
          />
          {/* Своя кнопка вместо AIInput.Submit: тот трёхликий контрол подменяет
              глиф на диктовку и стоп, а отправка в чате Narra всегда читается
              одной стрелкой вверх. */}
          <Pressable
            accessibilityLabel={sendLabel}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canPress }}
            disabled={!canPress}
            hitSlop={spacingPixels[8]}
            onPress={handlePress}
            style={({ pressed }) => [
              styles.submit,
              { backgroundColor: colors.primary },
              !canPress && styles.submitInert,
              pressed && styles.submitPressed,
            ]}
          >
            <MishanaerIcon name="arrow-up" size={SUBMIT_GLYPH} color={colors.primaryForeground} />
          </Pressable>
        </AIInput.Row>
      </AIInput>
    </View>
  );
}

// Отступы те же, что были у прежнего композера: поле не липнет к краям экрана,
// а снизу остаётся запас под безопасную зону, когда клавиатура убрана.
/** Зазор между полем и клавиатурой. */
const KEYBOARD_GAP = spacingPixels[8];
/** Библиотечный md-радиус равен 26; по макету внешний контур на 6 пунктов круглее. */
const INPUT_RADIUS = radiusPixels[34];
/** Диаметр кнопки отправки внутри поля. */
const SUBMIT_SIZE = spacingPixels[32];
const SUBMIT_GLYPH = spacingPixels[16];
/** Зазор между кнопкой и контуром поля. */
const SUBMIT_INSET = spacingPixels[6];
const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacingPixels[16],
    paddingTop: spacingPixels[6],
  },
  input: {
    borderCurve: "continuous",
    borderRadius: INPUT_RADIUS,
    borderWidth: 1,
    boxShadow: [],
    overflow: "visible",
  },
  row: {
    // Кнопка держится за нижнюю строку: у растущего поля выравнивание по центру
    // уводило её на середину абзаца.
    alignItems: "flex-end",
    // Свой отступ вместо библиотечного: кнопка стоит в 6 pt от контура поля.
    padding: SUBMIT_INSET,
    position: "relative",
  },

  field: {
    // У многострочного TextInput на iOS есть свой вертикальный запас: при
    // выравнивании строки по низу он уходит под текст и поднимает его над
    // центром капсулы. Центрируем сам бокс поля — кнопка остаётся внизу.
    alignSelf: "center",
  },
  submit: {
    alignItems: "center",
    alignSelf: "flex-end",
    borderRadius: SUBMIT_SIZE / 2,
    height: SUBMIT_SIZE,
    justifyContent: "center",
    width: SUBMIT_SIZE,
  },
  submitInert: { opacity: 0.4 },
  submitPressed: { opacity: 0.7 },
});

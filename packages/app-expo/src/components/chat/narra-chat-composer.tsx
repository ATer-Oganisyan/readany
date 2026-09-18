import { MishanaerIcon } from "@/components/ui/MishanaerIcon";
import { fontFamily, fontSize, useTheme } from "@/styles/theme";
import { radiusPixels, spacingPixels } from "@deslop/primitives";
import { AIInput } from "panelui-native";
import type { ComponentPropsWithRef } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Animated, Easing, Pressable, StyleSheet, TextInput, View } from "react-native";
import { KeyboardController } from "react-native-keyboard-controller";
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
  const { t } = useTranslation();
  const { bottom: safeAreaBottom } = useSafeAreaInsets();
  const text = props.text ?? "";
  const inputProps = props.textInputProps;
  const onSend = props.onSend;
  const placeholder = inputProps?.placeholder ?? "";
  const [displayedPlaceholder, setDisplayedPlaceholder] = useState(placeholder);
  const placeholderOpacity = useRef(new Animated.Value(1)).current;
  const visiblePlaceholder = useRef(placeholder);

  useEffect(() => {
    if (text || visiblePlaceholder.current === placeholder) {
      visiblePlaceholder.current = placeholder;
      setDisplayedPlaceholder(placeholder);
      placeholderOpacity.setValue(1);
      return;
    }
    const fade = (toValue: number) =>
      Animated.timing(placeholderOpacity, {
        toValue,
        duration: 150,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      });
    fade(0).start(({ finished }) => {
      if (!finished) return;
      visiblePlaceholder.current = placeholder;
      setDisplayedPlaceholder(placeholder);
      fade(1).start();
    });
    return () => placeholderOpacity.stopAnimation();
  }, [placeholder, placeholderOpacity, text]);

  // Иногда поле остаётся first responder без клавиатуры: после смены языка
  // клавиатуры или интерактивного свайпа iOS её убирает, а фокус с TextInput
  // не снимает. Повторный тап по уже сфокусированному полю фокус не меняет,
  // и клавиатура не поднимается — только всплывает системное меню «AutoFill».
  // Лечение то же, что в UIKit: снять фокус и вернуть его.
  const fieldFocusedRef = useRef(false);
  const focusRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // С подключённой аппаратной клавиатурой экранной нет и при живом фокусе, поэтому
  // без этого флага перефокусировка сама себя перезапускала бы бесконечно.
  const didRetryRef = useRef(false);
  const refocusIfKeyboardHidden = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput();
    if (!input || !fieldFocusedRef.current || KeyboardController.isVisible()) return;
    didRetryRef.current = true;
    TextInput.State.blurTextInput(input);
    requestAnimationFrame(() => TextInput.State.focusTextInput(input));
  }, []);
  // Тап — новое намерение пользователя: разрешаем следующий повтор.
  const handleFieldPressIn = useCallback(() => {
    didRetryRef.current = false;
    refocusIfKeyboardHidden();
  }, [refocusIfKeyboardHidden]);
  const handleFieldFocus = useCallback(() => {
    fieldFocusedRef.current = true;
    if (didRetryRef.current) return;
    // Фокус получен, а клавиатура так и не показалась — один повтор.
    if (focusRetryTimer.current) clearTimeout(focusRetryTimer.current);
    focusRetryTimer.current = setTimeout(() => {
      focusRetryTimer.current = null;
      refocusIfKeyboardHidden();
    }, KEYBOARD_SHOW_GRACE_MS);
  }, [refocusIfKeyboardHidden]);
  const handleFieldBlur = useCallback(() => {
    fieldFocusedRef.current = false;
    if (focusRetryTimer.current) {
      clearTimeout(focusRetryTimer.current);
      focusRetryTimer.current = null;
    }
  }, []);
  useEffect(
    () => () => {
      if (focusRetryTimer.current) clearTimeout(focusRetryTimer.current);
    },
    [],
  );

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed && !allowSendWithoutText) return;
      onSend?.({ text: trimmed } as Partial<TMessage>, true);
    },
    [allowSendWithoutText, onSend],
  );

  const canPress = isStreaming ? Boolean(onStop) : text.trim().length > 0 || allowSendWithoutText;
  const sendLabel = isStreaming ? t("common.stop", "Остановить") : t("narra.send", "Отправить");
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
          <View style={{ flex: 1, alignSelf: "center" }}>
            <AIInput.Field
              accessibilityLabel={inputProps?.placeholder}
              autoFocus={inputProps?.autoFocus}
              editable={inputProps?.editable}
              nativeID={inputProps?.nativeID}
              onBlur={handleFieldBlur}
              onFocus={handleFieldFocus}
              onPressIn={handleFieldPressIn}
              placeholder=""
              style={styles.field}
            />
            {!text && (
              <View pointerEvents="none" style={styles.placeholder} accessible={false}>
                <Animated.Text
                  accessible={false}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[
                    styles.placeholderText,
                    { color: colors.mutedForeground, opacity: placeholderOpacity },
                  ]}
                >
                  {displayedPlaceholder.replace(/[\r\n]+/g, " ")}
                </Animated.Text>
              </View>
            )}
          </View>
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
/** Сколько ждать клавиатуру после фокуса, прежде чем перефокусировать поле. */
const KEYBOARD_SHOW_GRACE_MS = 400;
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
    flex: 0,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.base,
  },
  placeholder: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: "center",
    paddingHorizontal: spacingPixels[8],
  },
  placeholderText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.base,
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

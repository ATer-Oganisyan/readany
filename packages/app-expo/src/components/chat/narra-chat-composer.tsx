import { useKeyboardInsets } from "@/hooks/use-keyboard-insets";
import { useTheme } from "@/styles/theme";
import { radiusPixels, spacingPixels } from "@deslop/primitives";
import { AIInput } from "panelui-native";
import type { ComponentPropsWithRef } from "react";
import { useCallback } from "react";
import { type LayoutChangeEvent, StyleSheet, type TextInput, View } from "react-native";
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
  floating?: boolean;
  onHeightChange?: (height: number) => void;
  onStop?: () => void;
  textInputProps?: ComponentPropsWithRef<typeof TextInput>;
};

export function NarraChatComposer<TMessage extends IMessage>({
  allowSendWithoutText = false,
  floating = false,
  isStreaming = false,
  onHeightChange,
  onStop,
  ...props
}: RuntimeToolbarProps<TMessage>) {
  const { colors } = useTheme();
  const keyboardInsets = useKeyboardInsets();
  const safeAreaBottom = keyboardInsets.safeAreaBottom;
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

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onHeightChange?.(Math.ceil(event.nativeEvent.layout.height)),
    [onHeightChange],
  );

  return (
    // Нижний отступ живёт в этом контейнере, а не в margin у AIInput: лента
    // резервирует место под инпут по измеренной высоте этой вьюхи, и отступ
    // снаружи неё в измерение не попадал — последнее сообщение подрезалось.
    <View
      onLayout={handleLayout}
      style={[
        styles.container,
        {
          paddingBottom:
            KEYBOARD_GAP + (floating || !keyboardInsets.isVisible ? safeAreaBottom : 0),
        },
      ]}
    >
      <AIInput
        avoidKeyboard={floating}
        keyboardBottomInset={floating ? safeAreaBottom + KEYBOARD_GAP : 0}
        native
        onStop={onStop}
        onSubmit={handleSubmit}
        onValueChange={inputProps?.onChangeText}
        status={isStreaming ? "streaming" : "ready"}
        style={[styles.input, { borderColor: colors.border }]}
        value={text}
      >
        {/* Сам TextInput остаётся многострочным и растёт вместе с текстом. */}
        <AIInput.Row style={styles.row}>
          {/* На iOS многострочное поле растёт вместе с текстом. После отправки
              пустому полю возвращается высота control-md из primitives. Это сжимает
              его обратно до строки, но сохраняет тот же нативный TextInput и
              его фокус — клавиатура больше не закрывается и не открывается
              заново. */}
          <AIInput.Field
            accessibilityLabel={inputProps?.placeholder}
            autoFocus={inputProps?.autoFocus}
            editable={inputProps?.editable}
            placeholder={inputProps?.placeholder ?? ""}
            style={[styles.field, text.length === 0 ? styles.emptyField : undefined]}
          />
          <AIInput.Submit />
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
    position: "relative",
  },
  field: {
    minHeight: spacingPixels[32],
    paddingBottom: spacingPixels[6],
    paddingTop: spacingPixels[6],
  },
  emptyField: {
    height: spacingPixels[32],
  },
});

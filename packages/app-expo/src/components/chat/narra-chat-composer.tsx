import { useKeyboardInsets } from "@/hooks/use-keyboard-insets";
import { spacingPixels } from "@deslop/primitives";
import { AIInput } from "panelui-native";
import type { ComponentPropsWithRef } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  isStreaming = false,
  onHeightChange,
  onStop,
  ...props
}: RuntimeToolbarProps<TMessage>) {
  const keyboardInsets = useKeyboardInsets();
  const safeAreaBottom = keyboardInsets.safeAreaBottom;
  /**
   * Счётчик сбросов поля.
   *
   * В строчном режиме PanelUI не задаёт полю минимальную высоту, и выросший
   * многострочный TextInput не возвращается к одной строке даже когда текст
   * очищен: RN держит уже измеренную высоту. Лента резервирует место под
   * инпут по его высоте, поэтому после отправки между сообщением и полем
   * оставался провал. Меняем key на переходе «текст был → текста нет», чтобы
   * поле пересоздалось в своей естественной высоте.
   */
  const [fieldGeneration, setFieldGeneration] = useState(0);
  const hadTextRef = useRef(false);
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

  useEffect(() => {
    const hasText = text.length > 0;
    if (hadTextRef.current && !hasText) setFieldGeneration((value) => value + 1);
    hadTextRef.current = hasText;
  }, [text]);

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
        { paddingBottom: KEYBOARD_GAP + (keyboardInsets.isVisible ? 0 : safeAreaBottom) },
      ]}
    >
      <AIInput
        avoidKeyboard={false}
        // Тень рисует не PanelUI: класс shadow-md убран, отделение поля от фона
        // остаётся за материалом платформы — на iOS 26 это край самого стекла.
        className="shadow-none"
        keyboardBottomInset={0}
        native
        onStop={onStop}
        onSubmit={handleSubmit}
        onValueChange={inputProps?.onChangeText}
        status={isStreaming ? "streaming" : "ready"}
        value={text}
      >
        {/* Выравнивание оставлено библиотечным — по центру. Прижатие к низу
            здесь не работает: настоящая высота многострочного поля компоненту
            неизвестна из-за платформенного инсета, и текст уезжает ниже
            контролов рядом. Это описано в исходниках PanelUI как отвергнутый
            вариант, и на нашем экране повторилось ровно так же. */}
        <AIInput.Row>
          {/* Без принудительной минимальной высоты: на iOS многострочное поле
              прижимает текст к верху, а textAlignVertical, которым библиотека
              центрует его в этом режиме, работает только на Android — лишняя
              высота дала бы перекос. Поле обнимает свой текст. */}
          <AIInput.Field key={fieldGeneration} placeholder={inputProps?.placeholder} />
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
const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacingPixels[16],
    paddingTop: spacingPixels[6],
  },
});

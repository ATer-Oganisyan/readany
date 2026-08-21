import { forwardRef, useCallback } from "react";
import type { ComponentPropsWithRef, MutableRefObject, RefCallback } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  KeyboardChatScrollView,
  type KeyboardChatScrollViewProps,
  type KeyboardChatScrollViewRef,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type NarraKeyboardChatScrollViewProps = KeyboardChatScrollViewProps & {
  chatScrollViewRef: MutableRefObject<KeyboardChatScrollViewRef | null>;
  scrollOffsetRef: MutableRefObject<number>;
  /**
   * Сколько ещё осталось до живого края.
   *
   * Слежение за ответом нельзя вешать на atEnd из MessageScroller: это
   * JS-зеркало, которое обновляется только событием скролла, а на открытом
   * чате скролла ещё не было — оно остаётся false, и следящий эффект молчит.
   * Здесь значение считается из того же события и стартует с нуля, потому что
   * лента открывается у края.
   */
  distanceFromBottomRef: MutableRefObject<number>;
};

/**
 * ScrollView-адаптер для FlatList внутри PanelUI MessageScroller.
 *
 * KeyboardChatScrollView отвечает и за keyboard inset, и за сдвиг видимого
 * контента. Отдельный ref нужен потому, что FlatList.scrollToEnd не учитывает
 * динамический inset клавиатуры и может остановиться раньше живого края.
 */
export const NarraKeyboardChatScrollView = forwardRef<
  KeyboardChatScrollViewRef,
  NarraKeyboardChatScrollViewProps
>(({ chatScrollViewRef, distanceFromBottomRef, scrollOffsetRef, ...props }, ref) => {
  const { bottom: safeAreaBottom } = useSafeAreaInsets();
  const combinedRef: RefCallback<KeyboardChatScrollViewRef> = useCallback(
    (instance) => {
      if (typeof ref === "function") ref(instance);
      else if (ref) ref.current = instance;
      chatScrollViewRef.current = instance;
    },
    [chatScrollViewRef, ref],
  );
  // keyboard-controller ships its own React declaration boundary. Reusing the
  // component's exact ref type avoids a false incompatibility between identical
  // React 19 RefCallback types resolved from two package paths.
  const keyboardRef = combinedRef as unknown as ComponentPropsWithRef<
    typeof KeyboardChatScrollView
  >["ref"];
  const originalOnScroll = props.onScroll;
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      scrollOffsetRef.current = contentOffset.y;
      distanceFromBottomRef.current = Math.max(
        0,
        contentSize.height - contentOffset.y - layoutMeasurement.height,
      );
      if (typeof originalOnScroll === "function") originalOnScroll(event);
    },
    [distanceFromBottomRef, originalOnScroll, scrollOffsetRef],
  );

  return (
    <KeyboardChatScrollView
      {...props}
      ref={keyboardRef}
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustKeyboardInsets={false}
      contentInsetAdjustmentBehavior="never"
      keyboardDismissMode="interactive"
      keyboardLiftBehavior="always"
      offset={safeAreaBottom}
      onScroll={handleScroll}
    />
  );
});

NarraKeyboardChatScrollView.displayName = "NarraKeyboardChatScrollView";

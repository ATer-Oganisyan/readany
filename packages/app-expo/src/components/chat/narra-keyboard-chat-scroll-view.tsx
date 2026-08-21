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
>(({ chatScrollViewRef, scrollOffsetRef, ...props }, ref) => {
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
      scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
      if (typeof originalOnScroll === "function") originalOnScroll(event);
    },
    [originalOnScroll, scrollOffsetRef],
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

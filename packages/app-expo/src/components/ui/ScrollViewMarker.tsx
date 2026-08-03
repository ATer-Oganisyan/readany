import { UIManager, View } from "react-native";
import {
  ScrollViewMarker as NativeScrollViewMarker,
  type ScrollViewMarkerProps,
} from "react-native-screens/experimental";

const nativeMarkerAvailable = Boolean(UIManager.getViewManagerConfig("RNSScrollViewMarker"));

/** Keeps older development clients usable until their native binary is rebuilt. */
export function ScrollViewMarker({ scrollEdgeEffects, ...props }: ScrollViewMarkerProps) {
  if (!nativeMarkerAvailable) return <View {...props} />;

  return <NativeScrollViewMarker scrollEdgeEffects={scrollEdgeEffects} {...props} />;
}

import { Platform, View } from "react-native";
import {
  ScrollViewMarker as NativeScrollViewMarker,
  type ScrollViewMarkerProps,
} from "react-native-screens/experimental";

/** Connects the first descendant scroll view to the native iOS edge effects. */
export function ScrollViewMarker({ scrollEdgeEffects, ...props }: ScrollViewMarkerProps) {
  if (Platform.OS !== "ios") {
    return <View {...props} />;
  }

  return <NativeScrollViewMarker scrollEdgeEffects={scrollEdgeEffects} {...props} />;
}

import {
  ScrollViewMarker as NativeScrollViewMarker,
  type ScrollViewMarkerProps,
} from "react-native-screens/experimental";

/** Connects the first descendant scroll view to the native iOS edge effects. */
export function ScrollViewMarker({ scrollEdgeEffects, ...props }: ScrollViewMarkerProps) {
  return <NativeScrollViewMarker scrollEdgeEffects={scrollEdgeEffects} {...props} />;
}

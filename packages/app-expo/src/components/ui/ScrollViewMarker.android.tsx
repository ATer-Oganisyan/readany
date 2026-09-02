import { View } from "react-native";
import type { ScrollViewMarkerProps } from "react-native-screens/experimental";

/** Android does not support the iOS scroll edge effects configured by this wrapper. */
export function ScrollViewMarker({ scrollEdgeEffects: _, ...props }: ScrollViewMarkerProps) {
  return <View {...props} />;
}

import { View, type ViewProps } from "react-native";

export interface SystemSheetZoomDestinationProps extends ViewProps {
  alignToContent?: boolean;
  sourceId?: string;
  expanded: boolean;
}

export function SystemSheetZoomDestination({
  alignToContent,
  children,
  style,
}: SystemSheetZoomDestinationProps) {
  return alignToContent ? <View style={style}>{children}</View> : null;
}

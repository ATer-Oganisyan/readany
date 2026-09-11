import { View, type ViewProps } from "react-native";

export function SystemSheetZoomSource({
  sourceId: _sourceId,
  ...props
}: ViewProps & { sourceId: string }) {
  return <View {...props} />;
}

export async function prepareSheetZoom(_sourceId: string): Promise<void> {}

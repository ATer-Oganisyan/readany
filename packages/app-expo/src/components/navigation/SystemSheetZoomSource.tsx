import { View, type ViewProps } from "react-native";

export function SystemSheetZoomSource({
  sourceId: _sourceId,
  onZoomReturn: _onZoomReturn,
  ...props
}: ViewProps & { sourceId: string; onZoomReturn?: () => void }) {
  return <View {...props} />;
}

export async function prepareSheetZoom(_sourceId: string): Promise<void> {}

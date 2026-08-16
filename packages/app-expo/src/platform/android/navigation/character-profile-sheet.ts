export function getAndroidCharacterProfileSheetOptions() {
  return {
    presentation: "formSheet" as const,
    animation: "slide_from_bottom" as const,
    headerShown: false,
    sheetAllowedDetents: [1],
    sheetInitialDetentIndex: 0,
    sheetGrabberVisible: true,
    sheetExpandsWhenScrolledToEdge: false,
  };
}

export function getAndroidCharacterProfileSheetRuntimeOptions(backgroundColor: string) {
  return {
    contentStyle: { backgroundColor },
    sheetAllowedDetents: [1],
    sheetInitialDetentIndex: 0,
    sheetExpandsWhenScrolledToEdge: false,
    sheetResizeAnimationEnabled: false,
  };
}

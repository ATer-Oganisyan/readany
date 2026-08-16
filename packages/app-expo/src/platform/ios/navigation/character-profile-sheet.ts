export function getIosCharacterProfileSheetOptions() {
  return {
    presentation: "formSheet" as const,
    animation: "slide_from_bottom" as const,
    headerShown: false,
    sheetAllowedDetents: [0.78, 1],
    sheetInitialDetentIndex: 0,
    sheetGrabberVisible: true,
    sheetExpandsWhenScrolledToEdge: true,
  };
}

export function getIosCharacterProfileSheetRuntimeOptions(
  portraitReady: boolean,
  backgroundColor: string,
) {
  return {
    contentStyle: { backgroundColor },
    sheetAllowedDetents: portraitReady ? [0.78, 1] : ("fitToContents" as const),
    sheetInitialDetentIndex: 0,
    sheetExpandsWhenScrolledToEdge: portraitReady,
    sheetResizeAnimationEnabled: true,
  };
}

import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import { View } from "react-native";
import type { ReaderToolbarProps } from "./ReaderToolbar.types";

const TOOLBAR_HEIGHT = 50;

interface NativeReaderToolbarProps extends ReaderToolbarProps {
  speechLabel: string;
  chatLabel: string;
  charactersLabel: string;
  sceneLabel: string;
  style: { width: "100%"; height: number };
}

const NativeReaderToolbar = requireNativeView(
  "ReadAnyNativeControls",
  "ReadAnyReaderToolbar",
) as ComponentType<NativeReaderToolbarProps>;

export function ReaderToolbar(props: ReaderToolbarProps) {
  return (
    <View style={{ width: "100%", height: TOOLBAR_HEIGHT }}>
      <NativeReaderToolbar
        {...props}
        speechLabel="Озвучить"
        chatLabel="Открыть чат"
        charactersLabel="Персонажи"
        sceneLabel="Создать сцену"
        style={{ width: "100%", height: TOOLBAR_HEIGHT }}
      />
    </View>
  );
}

export { TOOLBAR_HEIGHT };
export type { ReaderToolbarProps } from "./ReaderToolbar.types";

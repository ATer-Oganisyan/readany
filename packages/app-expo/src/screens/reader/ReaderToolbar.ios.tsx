import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import { View } from "react-native";
import type { ReaderToolbarProps } from "./ReaderToolbar.types";

const TOOLBAR_HEIGHT = 50;

interface NativeReaderToolbarProps extends ReaderToolbarProps {
  speechLabel: string;
  chatLabel: string;
  settingsLabel: string;
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
        speechLabel="Слушать"
        chatLabel="Чат"
        settingsLabel="Оформление"
        style={{ width: "100%", height: TOOLBAR_HEIGHT }}
      />
    </View>
  );
}

export { TOOLBAR_HEIGHT };
export type { ReaderToolbarProps } from "./ReaderToolbar.types";

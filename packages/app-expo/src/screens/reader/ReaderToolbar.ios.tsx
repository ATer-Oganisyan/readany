import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type { ReaderToolbarProps } from "./ReaderToolbar.types";

export const TOOLBAR_HEIGHT = 50;

interface NativeReaderToolbarProps {
  tintColor: string;
  isDark: boolean;
  speechActive: boolean;
  speechLoading: boolean;
  speechLabel: string;
  speechStopLabel: string;
  speechLoadingLabel: string;
  charactersLabel: string;
  charactersSheetSourceId: string;
  speechSheetSourceId: string;
  onSpeechPress: () => void;
  onCharactersPress: () => void;
  style: { width: "100%"; height: number };
}

const NativeReaderToolbar = requireNativeView(
  "ReadAnyNativeControls",
  "ReadAnyReaderToolbar",
) as ComponentType<NativeReaderToolbarProps>;

export function ReaderToolbar({
  charactersSheetSourceId = "",
  speechSheetSourceId = "",
  ...props
}: ReaderToolbarProps) {
  const { t } = useTranslation();

  return (
    <NativeReaderToolbar
      tintColor={props.tintColor}
      isDark={props.isDark}
      speechActive={false}
      speechLoading={false}
      speechLabel={t("reader.audio", "Аудио")}
      speechStopLabel={t("tts.stopShort", "Стоп")}
      speechLoadingLabel={t("reader.audioLoading", "Загрузка аудио")}
      charactersLabel={t("narra.characters", "Персонажи")}
      charactersSheetSourceId={charactersSheetSourceId}
      speechSheetSourceId={speechSheetSourceId}
      onSpeechPress={props.onSpeechPress}
      onCharactersPress={props.onCharactersPress}
      style={{ width: "100%", height: TOOLBAR_HEIGHT }}
    />
  );
}

export type { ReaderToolbarProps } from "./ReaderToolbar.types";

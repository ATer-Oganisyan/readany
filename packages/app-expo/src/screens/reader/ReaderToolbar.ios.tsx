import { AUDIOBOOK_PLAYER_ENABLED } from "@/lib/audiobook-player";
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
  speechState,
  charactersSheetSourceId = "",
  speechSheetSourceId = "",
  ...props
}: ReaderToolbarProps) {
  const { t } = useTranslation();

  return (
    <NativeReaderToolbar
      tintColor={props.tintColor}
      isDark={props.isDark}
      speechActive={!AUDIOBOOK_PLAYER_ENABLED && speechState === "playing"}
      speechLoading={!AUDIOBOOK_PLAYER_ENABLED && speechState === "loading"}
      speechLabel={
        AUDIOBOOK_PLAYER_ENABLED ? t("reader.audio", "Аудио") : t("reader.listen", "Слушать")
      }
      speechStopLabel={t("tts.stopShort", "Стоп")}
      speechLoadingLabel={t("reader.audioLoading", "Загрузка аудио")}
      charactersLabel={t("narra.characters", "Персонажи")}
      charactersSheetSourceId={charactersSheetSourceId}
      speechSheetSourceId={AUDIOBOOK_PLAYER_ENABLED ? speechSheetSourceId : ""}
      onSpeechPress={props.onSpeechPress}
      onCharactersPress={props.onCharactersPress}
      style={{ width: "100%", height: TOOLBAR_HEIGHT }}
    />
  );
}

export type { ReaderToolbarProps } from "./ReaderToolbar.types";

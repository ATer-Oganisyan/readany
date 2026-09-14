import type { ReadSettings } from "@readany/core/types";

export interface ReaderSettingsPanelProps {
  visible: boolean;
  readSettings: ReadSettings;
  onClose: () => void;
  onUpdateSetting: <K extends keyof ReadSettings>(key: K, value: ReadSettings[K]) => void;
}

export const READER_TEXT_SETTINGS = [
  {
    key: "fontSize",
    label: "reader.fontSize",
    fallback: "Размер шрифта",
    min: 12,
    max: 64,
    step: 1,
    scale: 1,
  },
  {
    key: "lineHeight",
    label: "reader.lineHeight",
    fallback: "Высота линии",
    min: 12,
    max: 25,
    step: 1,
    scale: 10,
  },
  {
    key: "paragraphSpacing",
    label: "reader.paragraphSpacing",
    fallback: "Расстояние между абзацами",
    min: 0,
    max: 24,
    step: 2,
    scale: 1,
  },
  {
    key: "pageMargin",
    label: "reader.pageMargin",
    fallback: "Поле страницы",
    min: 0,
    max: 48,
    step: 4,
    scale: 1,
  },
] as const;

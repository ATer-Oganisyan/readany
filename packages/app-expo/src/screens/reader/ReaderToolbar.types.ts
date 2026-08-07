export interface ReaderToolbarProps {
  tintColor: string;
  isDark: boolean;
  speechActive: boolean;
  onSpeechPress: () => void;
  onChatPress: () => void;
  /** Кнопка «Aa» — настройки оформления читалки (шрифт, тема, прокрутка). */
  onSettingsPress: () => void;
}

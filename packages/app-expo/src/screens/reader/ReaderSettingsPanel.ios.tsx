import { SCENE_SUGGESTION_INTERVALS } from "@/lib/narra/scene-suggestion";
import { READER_PAGE_THEMES } from "@/lib/reader/reader-themes";
import { SB_SANS_READER_FONT_ID } from "@/lib/reader/bundled-reader-font";
import { useNarraStore } from "@/stores";
import { useTheme } from "@/styles/theme";
import {
  BottomSheet,
  Form,
  Group,
  Host,
  Picker,
  Section,
  Text,
  Toggle,
} from "@expo/ui/swift-ui";
import {
  labelsHidden,
  pickerStyle,
  presentationDetents,
  presentationDragIndicator,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useFontStore } from "@readany/core/stores";
import type { ReadSettings } from "@readany/core/types";
import { requireNativeView } from "expo";
import { type ComponentType, type ReactNode, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  visible: boolean;
  readSettings: ReadSettings;
  onClose: () => void;
  onUpdateSetting: <K extends keyof ReadSettings>(key: K, value: ReadSettings[K]) => void;
}

const DEFAULT_FONT_ID = "__default__";

interface NativeNavigationStackProps {
  title: string;
  closeAccessibilityLabel: string;
  onClosePress: () => void;
  children: ReactNode;
}

const NativeNavigationStack = requireNativeView(
  "ReadAnyNativeControls",
  "ReadAnyNavigationStack",
) as ComponentType<NativeNavigationStackProps>;

interface NativeValueStepperProps {
  label: string;
  value: number;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  decrementAccessibilityLabel: string;
  incrementAccessibilityLabel: string;
  onValueChange: (event: { nativeEvent: { value: number } }) => void;
}

const NativeValueStepper = requireNativeView(
  "ReadAnyNativeControls",
  "ReadAnyValueStepper",
) as ComponentType<NativeValueStepperProps>;

export function ReaderSettingsPanel({ visible, readSettings, onClose, onUpdateSetting }: Props) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const customFonts = useFontStore((state) => state.fonts);
  const selectedFontId = useFontStore((state) => state.selectedFontId);
  const setSelectedFont = useFontStore((state) => state.setSelectedFont);
  const sceneInterval = useNarraStore((state) => state.sceneSuggestionInterval);
  const setSceneInterval = useNarraStore((state) => state.setSceneSuggestionInterval);

  const handlePresentationChange = useCallback(
    (isPresented: boolean) => {
      if (!isPresented) onClose();
    },
    [onClose],
  );

  return (
    <Host
      colorScheme={isDark ? "dark" : "light"}
      style={{ position: "absolute", width: 1, height: 1 }}
    >
      <BottomSheet isPresented={visible} onIsPresentedChange={handlePresentationChange}>
        <Group modifiers={[presentationDetents(["large"]), presentationDragIndicator("visible")]}>
          <NativeNavigationStack
            title={t("reader.settings", "Настройки чтения")}
            closeAccessibilityLabel={t("common.close", "Закрыть")}
            onClosePress={onClose}
          >
            <Form modifiers={[tint(colors.primary)]}>
              <Section title={t("reader.pageTheme", "Тема страницы")}>
                <Picker
                  label={t("reader.pageTheme", "Тема страницы")}
                  selection={readSettings.readerTheme ?? "original"}
                  onSelectionChange={(value) => onUpdateSetting("readerTheme", value)}
                  modifiers={[pickerStyle("segmented"), labelsHidden()]}
                >
                  {READER_PAGE_THEMES.map((preset) => (
                    <Text key={preset.id} modifiers={[tag(preset.id)]}>
                      {t(preset.labelKey, preset.labelDefault)}
                    </Text>
                  ))}
                </Picker>
              </Section>

              <Section title={t("reader.textSettings", "Текст")}>
                <NativeValueStepper
                  label={t("reader.fontSize", "Размер шрифта")}
                  value={readSettings.fontSize}
                  valueLabel={String(readSettings.fontSize)}
                  min={12}
                  max={64}
                  step={1}
                  decrementAccessibilityLabel={t("common.decrease", "Уменьшить")}
                  incrementAccessibilityLabel={t("common.increase", "Увеличить")}
                  onValueChange={({ nativeEvent }) =>
                    onUpdateSetting("fontSize", nativeEvent.value)
                  }
                />
                <NativeValueStepper
                  label={t("reader.lineHeight", "Высота линии")}
                  value={Math.round(readSettings.lineHeight * 10)}
                  valueLabel={readSettings.lineHeight.toFixed(1)}
                  min={12}
                  max={25}
                  step={1}
                  decrementAccessibilityLabel={t("common.decrease", "Уменьшить")}
                  incrementAccessibilityLabel={t("common.increase", "Увеличить")}
                  onValueChange={({ nativeEvent }) =>
                    onUpdateSetting("lineHeight", nativeEvent.value / 10)
                  }
                />
                <NativeValueStepper
                  label={t("reader.paragraphSpacing", "Расстояние между абзацами")}
                  value={readSettings.paragraphSpacing}
                  valueLabel={String(readSettings.paragraphSpacing)}
                  min={0}
                  max={24}
                  step={2}
                  decrementAccessibilityLabel={t("common.decrease", "Уменьшить")}
                  incrementAccessibilityLabel={t("common.increase", "Увеличить")}
                  onValueChange={({ nativeEvent }) =>
                    onUpdateSetting("paragraphSpacing", nativeEvent.value)
                  }
                />
                <NativeValueStepper
                  label={t("reader.pageMargin", "Поле страницы")}
                  value={readSettings.pageMargin}
                  valueLabel={String(readSettings.pageMargin)}
                  min={0}
                  max={48}
                  step={4}
                  decrementAccessibilityLabel={t("common.decrease", "Уменьшить")}
                  incrementAccessibilityLabel={t("common.increase", "Увеличить")}
                  onValueChange={({ nativeEvent }) =>
                    onUpdateSetting("pageMargin", nativeEvent.value)
                  }
                />
              </Section>

              <Section title={t("reader.appearance", "Оформление")}>
                <Picker
                  label={t("fonts.title", "Шрифт")}
                  selection={selectedFontId ?? DEFAULT_FONT_ID}
                  onSelectionChange={(value) =>
                    setSelectedFont(value === DEFAULT_FONT_ID ? null : value)
                  }
                  modifiers={[pickerStyle("menu")]}
                >
                  <Text modifiers={[tag(DEFAULT_FONT_ID)]}>{t("fonts.serif", "С засечками")}</Text>
                  <Text modifiers={[tag(SB_SANS_READER_FONT_ID)]}>
                    {t("fonts.sansSerif", "Без засечек")}
                  </Text>
                  {customFonts.map((customFont) => (
                    <Text key={customFont.id} modifiers={[tag(customFont.id)]}>
                      {customFont.name}
                    </Text>
                  ))}
                </Picker>

                <Picker
                  label={t("reader.viewMode", "Режим чтения")}
                  selection={readSettings.viewMode}
                  onSelectionChange={(value) => onUpdateSetting("viewMode", value)}
                  modifiers={[pickerStyle("menu")]}
                >
                  <Text modifiers={[tag("paginated")]}>
                    {t("reader.paginated", "Перелистывание")}
                  </Text>
                  <Text modifiers={[tag("scroll")]}>{t("reader.scrollMode", "Прокрутка")}</Text>
                </Picker>

                <Toggle
                  label={t("settings.showTopTitleProgress", "Название и прогресс сверху")}
                  isOn={readSettings.showTopTitleProgress !== false}
                  onIsOnChange={(value) => onUpdateSetting("showTopTitleProgress", value)}
                />
              </Section>

              <Section
                title={t("narra.sceneFrequencyTitle", "Частота врезок")}
                footer={
                  <Text>
                    {t("narra.sceneFrequencyDesc", "Как часто предлагать нарисовать сцену")}
                  </Text>
                }
              >
                <Picker
                  label={t("narra.sceneFrequencyTitle", "Частота врезок")}
                  selection={sceneInterval}
                  onSelectionChange={setSceneInterval}
                  modifiers={[pickerStyle("segmented"), labelsHidden()]}
                >
                  {SCENE_SUGGESTION_INTERVALS.map((value) => (
                    <Text key={value} modifiers={[tag(value)]}>
                      {value > 0
                        ? t("narra.sceneFrequencyPages", "{{count}} стр.", { count: value })
                        : t("narra.sceneFrequencyOff", "Выкл")}
                    </Text>
                  ))}
                </Picker>
              </Section>
            </Form>
          </NativeNavigationStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

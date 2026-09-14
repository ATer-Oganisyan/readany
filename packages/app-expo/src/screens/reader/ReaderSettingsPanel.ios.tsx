import { SCENE_SUGGESTION_INTERVALS } from "@/lib/narra/scene-suggestion";
import { READER_PAGE_THEMES } from "@/lib/reader/reader-themes";
import { useNarraStore } from "@/stores";
import { useTheme } from "@/styles/theme";
import { spacingPixels } from "@deslop/primitives";
import { BottomSheet, Form, Group, Host, Picker, Section, Text, Toggle } from "@expo/ui/swift-ui";
import {
  controlSize,
  frame,
  labelsHidden,
  pickerStyle,
  presentationDetents,
  presentationDragIndicator,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { requireNativeView } from "expo";
import { type ComponentType, type ReactNode, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  type ReaderSettingsPanelProps as Props,
  READER_TEXT_SETTINGS,
} from "./reader-settings-options";

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
                  modifiers={[
                    pickerStyle("segmented"),
                    controlSize("large"),
                    frame({ maxWidth: 10_000, height: spacingPixels[44] }),
                    labelsHidden(),
                  ]}
                >
                  {READER_PAGE_THEMES.map((preset) => (
                    <Text key={preset.id} modifiers={[tag(preset.id)]}>
                      {t(preset.labelKey, preset.labelDefault)}
                    </Text>
                  ))}
                </Picker>
              </Section>

              <Section title={t("reader.textSettings", "Текст")}>
                {READER_TEXT_SETTINGS.map((setting) => (
                  <NativeValueStepper
                    key={setting.key}
                    label={t(setting.label, setting.fallback)}
                    value={Math.round(readSettings[setting.key] * setting.scale)}
                    valueLabel={
                      setting.scale === 10
                        ? readSettings[setting.key].toFixed(1)
                        : String(readSettings[setting.key])
                    }
                    min={setting.min}
                    max={setting.max}
                    step={setting.step}
                    decrementAccessibilityLabel={t("common.decrease", "Уменьшить")}
                    incrementAccessibilityLabel={t("common.increase", "Увеличить")}
                    onValueChange={({ nativeEvent }) =>
                      onUpdateSetting(setting.key, nativeEvent.value / setting.scale)
                    }
                  />
                ))}
              </Section>

              <Section
                title={t("reader.appearance", "Оформление")}
                footer={
                  <Text>
                    {t("narra.sceneFrequencyDesc", "Как часто предлагать нарисовать сцену")}
                  </Text>
                }
              >
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

                <Picker
                  label={t("narra.sceneFrequencyTitle", "Частота врезок")}
                  selection={sceneInterval}
                  onSelectionChange={setSceneInterval}
                  modifiers={[pickerStyle("menu")]}
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

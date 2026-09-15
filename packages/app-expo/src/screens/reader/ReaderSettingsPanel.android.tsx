import type { NativeSettingsPickerProps } from "@/components/settings/NativeSettingsPicker.types";
import { SCENE_SUGGESTION_INTERVALS } from "@/lib/narra/scene-suggestion";
import { READER_PAGE_THEMES } from "@/lib/reader/reader-themes";
import { useNarraStore } from "@/stores";
import { bodyTypography, radius, spacing, useTheme } from "@/styles/theme";
import {
  Box,
  Column,
  HorizontalDivider,
  Host,
  LazyColumn,
  ListItem,
  ModalBottomSheet,
  DropdownMenu,
  DropdownMenuItem,
  Row,
  SegmentedButton,
  Shape,
  SingleChoiceSegmentedButtonRow,
  Surface,
  Switch,
  Text,
  TextButton,
  VerticalDivider,
} from "@expo/ui/jetpack-compose";
import {
  fillMaxHeight,
  fillMaxWidth,
  height,
  padding,
  weight,
  width,
} from "@expo/ui/jetpack-compose/modifiers";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { READER_TEXT_SETTINGS, type ReaderSettingsPanelProps } from "./reader-settings-options";

const sectionShape = Shape.RoundedCorner({
  cornerRadii: {
    topStart: radius.lg,
    topEnd: radius.lg,
    bottomStart: radius.lg,
    bottomEnd: radius.lg,
  },
});

function SettingsChoice({ label, selectedValue, options, onValueChange }: NativeSettingsPickerProps) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  return (
    <ListItem colors={{ containerColor: "transparent" }}>
      <ListItem.HeadlineContent>
        <Text style={bodyTypography}>{label}</Text>
      </ListItem.HeadlineContent>
      <ListItem.TrailingContent>
        <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)} color={colors.card}>
          <TextButton onClick={() => setExpanded(true)} colors={{ contentColor: colors.primary }}>
            <Text>{options.find((option) => option.value === selectedValue)?.label ?? ""}</Text>
          </TextButton>
          <DropdownMenu.Items>
            {options.map((option) => (
              <DropdownMenuItem key={option.value} onClick={() => {
                setExpanded(false);
                onValueChange(option.value);
              }}>
                <DropdownMenuItem.Text>
                  <Text color={option.value === selectedValue ? colors.primary : colors.foreground}>
                    {option.label}
                  </Text>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
            ))}
          </DropdownMenu.Items>
        </DropdownMenu>
      </ListItem.TrailingContent>
    </ListItem>
  );
}

export function ReaderSettingsPanel({
  visible,
  readSettings,
  onClose,
  onUpdateSetting,
}: ReaderSettingsPanelProps) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const sceneInterval = useNarraStore((state) => state.sceneSuggestionInterval);
  const setSceneInterval = useNarraStore((state) => state.setSceneSuggestionInterval);
  if (!visible) return null;
  const segmentColors = {
    activeContainerColor: colors.primary,
    activeContentColor: "#000000",
    inactiveContainerColor: colors.primary5,
    inactiveContentColor: colors.foreground,
    activeBorderColor: "transparent",
    inactiveBorderColor: "transparent",
  };
  const buttonColors = { contentColor: colors.primary };

  return (
    <Host
      style={{ position: "absolute", width: 1, height: 1 }}
      colorScheme={isDark ? "dark" : "light"}
    >
      <ModalBottomSheet
        onDismissRequest={onClose}
        skipPartiallyExpanded
        showDragHandle
        containerColor={colors.background}
        contentColor={colors.foreground}
      >
        <Column modifiers={[fillMaxHeight(0.9), fillMaxWidth()]}>
          <Text style={{ typography: "titleLarge" }} modifiers={[padding(24, 0, 24, 16)]}>
            {t("reader.settings", "Настройки чтения")}
          </Text>
          <LazyColumn modifiers={[weight(1), fillMaxWidth()]} contentPadding={{ bottom: 16 }}>
            <Text style={bodyTypography} modifiers={[padding(16, 16, 16, 8)]}>
              {t("reader.pageTheme", "Тема страницы")}
            </Text>
            <Surface
              color={colors.card}
              shape={sectionShape}
              modifiers={[padding(16, 0, 16, 0), fillMaxWidth()]}
            >
              <Column>
                <SingleChoiceSegmentedButtonRow modifiers={[padding(16, 8, 16, 8), fillMaxWidth()]}>
                  {READER_PAGE_THEMES.map((preset) => (
                    <SegmentedButton
                      showIcon={false}
                      key={preset.id}
                      selected={(readSettings.readerTheme ?? "original") === preset.id}
                      onClick={() => onUpdateSetting("readerTheme", preset.id)}
                      colors={segmentColors}
                    >
                      <SegmentedButton.Label>
                        <Text>{t(preset.labelKey, preset.labelDefault)}</Text>
                      </SegmentedButton.Label>
                    </SegmentedButton>
                  ))}
                </SingleChoiceSegmentedButtonRow>
              </Column>
            </Surface>
            <Text style={bodyTypography} modifiers={[padding(16, 16, 16, 8)]}>
              {t("reader.textSettings", "Текст")}
            </Text>
            <Surface
              color={colors.card}
              shape={sectionShape}
              modifiers={[padding(16, 0, 16, 0), fillMaxWidth()]}
            >
              <Column>
                {READER_TEXT_SETTINGS.map((setting, index) => {
                  const value = Math.round(readSettings[setting.key] * setting.scale);
                  const label = t(setting.label, setting.fallback);
                  return (
                    <Column key={setting.key}>
                      {index > 0 && <HorizontalDivider color={colors.border} />}
                      <ListItem colors={{ containerColor: "transparent" }}>
                        <ListItem.HeadlineContent>
                          <Text style={bodyTypography}>{label}</Text>
                        </ListItem.HeadlineContent>
                        <ListItem.TrailingContent>
                          <Surface
                            color={colors.primary5}
                            shape={sectionShape}
                            modifiers={[width(160)]}
                          >
                            <Row verticalAlignment="center" modifiers={[fillMaxWidth()]}>
                              <TextButton
                                modifiers={[weight(1)]}
                                enabled={value > setting.min}
                                colors={buttonColors}
                                onClick={() =>
                                  onUpdateSetting(
                                    setting.key,
                                    Math.max(setting.min, value - setting.step) / setting.scale,
                                  )
                                }
                              >
                                <Text>−</Text>
                              </TextButton>
                              <VerticalDivider
                                color={colors.primary20}
                                thickness={1}
                                modifiers={[height(spacing.xxl)]}
                              />
                              <Box contentAlignment="center" modifiers={[weight(1)]}>
                                <Text style={bodyTypography}>
                                  {setting.scale === 10
                                    ? readSettings[setting.key].toFixed(1)
                                    : String(readSettings[setting.key])}
                                </Text>
                              </Box>
                              <VerticalDivider
                                color={colors.primary20}
                                thickness={1}
                                modifiers={[height(spacing.xxl)]}
                              />
                              <TextButton
                                modifiers={[weight(1)]}
                                enabled={value < setting.max}
                                colors={buttonColors}
                                onClick={() =>
                                  onUpdateSetting(
                                    setting.key,
                                    Math.min(setting.max, value + setting.step) / setting.scale,
                                  )
                                }
                              >
                                <Text>+</Text>
                              </TextButton>
                            </Row>
                          </Surface>
                        </ListItem.TrailingContent>
                      </ListItem>
                    </Column>
                  );
                })}
              </Column>
            </Surface>
            <Text style={bodyTypography} modifiers={[padding(16, 16, 16, 8)]}>
              {t("reader.appearance", "Оформление")}
            </Text>
            <Surface
              color={colors.card}
              shape={sectionShape}
              modifiers={[padding(16, 0, 16, 0), fillMaxWidth()]}
            >
              <Column>
                  <SettingsChoice
                    label={t("reader.viewMode", "Режим чтения")}
                    selectedValue={readSettings.viewMode}
                    colorScheme={isDark ? "dark" : "light"}
                    options={[
                      { value: "paginated", label: t("reader.paginated", "Перелистывание") },
                      { value: "scroll", label: t("reader.scrollMode", "Прокрутка") },
                    ]}
                    onValueChange={(value) =>
                      onUpdateSetting("viewMode", value === "scroll" ? "scroll" : "paginated")
                    }
                  />
                {(["volumeButtonsPageTurn", "showTopTitleProgress"] as const).map((key) => (
                  <Column key={key}>
                    <HorizontalDivider color={colors.border} />
                    <ListItem colors={{ containerColor: "transparent" }}>
                      <ListItem.HeadlineContent>
                        <Text style={bodyTypography}>{t(`settings.${key}`)}</Text>
                      </ListItem.HeadlineContent>
                      <ListItem.TrailingContent>
                        <Switch
                          value={
                            key === "showTopTitleProgress"
                              ? readSettings[key] !== false
                              : Boolean(readSettings[key])
                          }
                          onCheckedChange={(value) => onUpdateSetting(key, value)}
                          colors={{
                            checkedTrackColor: colors.primary,
                            uncheckedTrackColor: colors.primary5,
                            uncheckedBorderColor: "transparent",
                          }}
                        />
                      </ListItem.TrailingContent>
                    </ListItem>
                  </Column>
                ))}
                <HorizontalDivider color={colors.border} />
                  <SettingsChoice
                    label={t("narra.sceneFrequencyTitle", "Частота врезок")}
                    selectedValue={String(sceneInterval)}
                    colorScheme={isDark ? "dark" : "light"}
                    options={SCENE_SUGGESTION_INTERVALS.map((value) => ({
                      value: String(value),
                      label: value
                        ? t("narra.sceneFrequencyPages", "{{count}} стр.", { count: value })
                        : t("narra.sceneFrequencyOff", "Выкл"),
                    }))}
                    onValueChange={(value) => {
                      const interval = SCENE_SUGGESTION_INTERVALS.find(
                        (option) => String(option) === value,
                      );
                      if (interval !== undefined) setSceneInterval(interval);
                    }}
                  />
              </Column>
            </Surface>
            <Text color={colors.primary40} style={{ typography: "bodyMedium" }} modifiers={[padding(16, 8, 16, 16)]}>
              {t("narra.sceneFrequencyDesc", "Как часто предлагать нарисовать сцену")}
            </Text>
          </LazyColumn>
        </Column>
      </ModalBottomSheet>
    </Host>
  );
}

import type { ReaderSettingsPanel as ReaderSettingsPanelComponent } from "./ReaderSettingsPanel";

type ReaderSettingsPanelType = typeof ReaderSettingsPanelComponent;

const readerSettingsPanelModule =
  process.env.EXPO_OS === "ios"
    ? require("./ReaderSettingsPanel.ios")
    : process.env.EXPO_OS === "android"
      ? require("./ReaderSettingsPanel.android")
      : require("./ReaderSettingsPanel");

export const ReaderSettingsPanel =
  readerSettingsPanelModule.ReaderSettingsPanel as ReaderSettingsPanelType;

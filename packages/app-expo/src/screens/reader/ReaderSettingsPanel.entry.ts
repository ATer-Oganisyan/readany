import type { ReaderSettingsPanel as ReaderSettingsPanelComponent } from "./ReaderSettingsPanel";

type ReaderSettingsPanelType = typeof ReaderSettingsPanelComponent;

const readerSettingsPanelModule =
  process.env.EXPO_OS === "ios"
    ? require("./ReaderSettingsPanel.ios")
    : require("./ReaderSettingsPanel");

export const ReaderSettingsPanel =
  readerSettingsPanelModule.ReaderSettingsPanel as ReaderSettingsPanelType;

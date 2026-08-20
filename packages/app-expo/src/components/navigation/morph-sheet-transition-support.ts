import { Platform } from "react-native";

const iosMajorVersion = Number.parseInt(String(Platform.Version), 10);

export const supportsMorphSheetTransition =
  Platform.OS === "ios" && Number.isFinite(iosMajorVersion) && iosMajorVersion >= 18;

import AppMetrica from "@appmetrica/react-native-analytics";
import { createAppMetricaBridge } from "./appmetrica-bridge";

export const appMetricaBridge = createAppMetricaBridge(
  AppMetrica,
  process.env.EXPO_PUBLIC_NARRA_APPMETRICA_API_KEY,
  process.env.EXPO_PUBLIC_NARRA_APPMETRICA_ENABLED === "true",
);

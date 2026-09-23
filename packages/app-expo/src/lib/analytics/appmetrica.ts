import { createAppMetricaBridge } from "./appmetrica-bridge";

export const appMetricaBridge = createAppMetricaBridge(
  // Load inside guarded activation: older dev clients may lack the native SDK.
  () => require("@appmetrica/react-native-analytics").default,
  process.env.EXPO_PUBLIC_NARRA_APPMETRICA_API_KEY,
  process.env.EXPO_PUBLIC_NARRA_APPMETRICA_ENABLED === "true",
);

import type { AnalyticsEvent, AnalyticsEventName, SafeAnalyticsValue } from "./contract";

type AnalyticsTier = "none" | "essential" | "extended";

export interface AppMetricaSdk {
  activate(config: { apiKey: string; statisticsSending: boolean }): void;
  setDataSendingEnabled(enabled: boolean): void;
  reportEvent(name: string, properties: Record<string, SafeAnalyticsValue>): void;
}

const SDK_LIFECYCLE_EVENTS = new Set<AnalyticsEventName>([
  "app_opened",
  "app_closed",
  "app_version_seen",
]);

export function createAppMetricaBridge(
  loadSdk: () => AppMetricaSdk,
  apiKey: string | undefined,
  featureEnabled: boolean,
) {
  const key = apiKey?.trim();
  let activated = false;
  let sending = false;
  let sdk: AppMetricaSdk | undefined;

  return {
    start(tier: AnalyticsTier): void {
      const shouldSend = Boolean(featureEnabled && key && tier !== "none");
      if (!activated) {
        if (!shouldSend || !key) return;
        try {
          sdk = loadSdk();
          sdk.activate({ apiKey: key, statisticsSending: true });
          activated = true;
          sending = true;
        } catch {
          // Analytics must not prevent the app from starting.
        }
        return;
      }
      if (sending !== shouldSend) {
        try {
          sdk?.setDataSendingEnabled(shouldSend);
          sending = shouldSend;
        } catch {
          // Retry on the next start.
        }
      }
    },
    report(event: AnalyticsEvent): void {
      if (!sending || SDK_LIFECYCLE_EVENTS.has(event.name)) return;
      try {
        sdk?.reportEvent(event.name, event.properties);
      } catch {
        // Gateway delivery remains independent.
      }
    },
  };
}

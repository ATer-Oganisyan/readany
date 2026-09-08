import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { AppState, Platform } from "react-native";
import { createDiagnosticJournal, diagnosticErrorReason } from "./diagnostic-journal";

const directory = `${FileSystem.documentDirectory}narra-diagnostics`;
const journalPath = `${directory}/events.json`;
const journal = createDiagnosticJournal({
  async read() {
    const info = await FileSystem.getInfoAsync(journalPath);
    if (!info.exists || info.size > 256_000) return "[]";
    return FileSystem.readAsStringAsync(journalPath);
  },
  async write(value) {
    if (!FileSystem.documentDirectory) return;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    await FileSystem.writeAsStringAsync(journalPath, value);
  },
});

export const recordDiagnostic = journal.record;
export { diagnosticErrorReason } from "./diagnostic-journal";

function diagnosticBackendHost(hostname: string): string {
  return hostname === "api.narra.disrupt.builders" || hostname === "api-test.narra.disrupt.builders"
    ? hostname
    : "custom";
}

function buildEnvironment(): "production" | "test" | "unknown" {
  if (process.env.EXPO_PUBLIC_NARRA_ENVIRONMENT === "production") return "production";
  if (process.env.EXPO_PUBLIC_NARRA_ENVIRONMENT === "test") return "test";
  return "unknown";
}

/** Checks the responding gateway without delaying or breaking an offline app start. */
export async function verifyNarraGatewayBackend(): Promise<void> {
  let hostname = "custom";
  try {
    const { getNarraGatewayConfig, probeNarraGatewayHealth } = await import(
      "@/lib/ai/narra-gateway-fetch"
    );
    try {
      hostname = new URL(getNarraGatewayConfig().baseUrl).hostname;
    } catch {
      // Invalid custom URLs are reported without persisting their contents.
    }
    const probe = await probeNarraGatewayHealth();
    const details =
      `host=${probe.hostname} build=${probe.buildEnvironment} ` +
      `expected=${probe.expectedEnvironment} actual=${probe.environment} ` +
      `version=${probe.version} ok=${probe.ok}`;
    if (probe.ok) console.info(`[NarraGateway] backend verified: ${details}`);
    else console.error(`[NarraGateway] BACKEND MISMATCH: ${details}`);
    recordDiagnostic("backend_probe", {
      host: diagnosticBackendHost(probe.hostname),
      buildEnvironment: probe.buildEnvironment,
      expectedEnvironment: probe.expectedEnvironment,
      environment: probe.environment,
      version: probe.version,
      ok: probe.ok,
    });
  } catch (error) {
    const reason = diagnosticErrorReason(error);
    console.warn(`[NarraGateway] backend verification failed: host=${hostname} reason=${reason}`);
    recordDiagnostic("backend_probe", {
      host: diagnosticBackendHost(hostname),
      buildEnvironment: buildEnvironment(),
      reason,
      ok: false,
    });
  }
}

/** Local only. No console interception, analytics upload, user IDs or book contents. */
export function startDiagnostics(): () => void {
  recordDiagnostic("app_started", { build: Number(Constants.nativeBuildVersion) });
  let state = AppState.currentState;
  let previousTick = Date.now();
  const subscription = AppState.addEventListener("change", (next) => {
    state = next;
    previousTick = Date.now();
    recordDiagnostic("app_state", { state: next });
    void journal.flush();
  });
  const timer = setInterval(() => {
    const now = Date.now();
    const delayMs = now - previousTick - 2000;
    previousTick = now;
    if (state === "active" && delayMs > 3000) recordDiagnostic("js_stall", { delayMs });
  }, 2000);
  return () => {
    subscription.remove();
    clearInterval(timer);
    void journal.flush();
  };
}

let sharing: Promise<void> | null = null;

export function shareDiagnosticLogs(title: string): Promise<void> {
  if (sharing) return sharing;
  sharing = (async () => {
    if (!(await Sharing.isAvailableAsync()) || !FileSystem.cacheDirectory) {
      throw new Error("Sharing unavailable");
    }
    await journal.flush();
    const safeVersion = (value: unknown) =>
      typeof value === "string" && /^[\d.+-]{1,40}$/.test(value) ? value : "unknown";
    const report = {
      schema: 1,
      createdAt: new Date().toISOString(),
      app: "Narra",
      version: safeVersion(Constants.nativeAppVersion ?? Constants.expoConfig?.version),
      build: safeVersion(Constants.nativeBuildVersion),
      platform: Platform.OS,
      os: safeVersion(String(Platform.Version)),
      channel: __DEV__ ? "development" : "production",
      note: "Local app diagnostics only; no book contents, chats, credentials or system crash reports.",
      events: await journal.snapshot(),
    };
    // One app-owned export; never include the whole Documents directory.
    const exportDirectory = `${FileSystem.cacheDirectory}narra-diagnostics-export`;
    await FileSystem.makeDirectoryAsync(exportDirectory, { intermediates: true });
    const path = `${exportDirectory}/Narra-logs.json`;
    await FileSystem.writeAsStringAsync(path, JSON.stringify(report, null, 2));
    await Sharing.shareAsync(path, {
      mimeType: "application/json",
      UTI: "public.json",
      dialogTitle: title,
    });
    // The native API resolves on cancellation too; do not claim delivery.
    recordDiagnostic("logs_share_closed");
  })()
    .catch((error) => {
      recordDiagnostic("logs_share_failed");
      throw error;
    })
    .finally(() => {
      sharing = null;
    });
  return sharing;
}

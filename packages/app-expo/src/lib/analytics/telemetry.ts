import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { eventBus } from "@readany/core/utils/event-bus";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { AppState, type AppStateStatus, Platform } from "react-native";
import {
  ANALYTICS_SCHEMA_VERSION,
  type AnalyticsEvent,
  type AnalyticsEventName,
  type SafeAnalyticsValue,
  isEssentialAnalyticsEvent,
  sanitizeAnalyticsProperties,
} from "./contract";

const QUEUE_LIMIT = 1_000;
const QUARANTINE_LIMIT = 200;
const BATCH_LIMIT = 100;
const EVENT_TTL_MS = 31 * 24 * 60 * 60 * 1_000;
const FLUSH_INTERVAL_MS = 30_000;
const ANALYTICS_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}narra-analytics`
  : null;
const QUEUE_FILE = ANALYTICS_DIR ? `${ANALYTICS_DIR}/queue.json` : null;
const QUARANTINE_FILE = ANALYTICS_DIR ? `${ANALYTICS_DIR}/quarantine.json` : null;

type AnalyticsTier = "none" | "essential" | "extended";

let queue: AnalyticsEvent[] | null = null;
let mutation = Promise.resolve();
let flushing = false;
let interval: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let productUnsubscribers: Array<() => void> = [];
let sessionId = Crypto.randomUUID();
let activeSince = Date.now();
let active = false;

function analyticsTier(): AnalyticsTier {
  const configured = process.env.EXPO_PUBLIC_NARRA_ANALYTICS_TIER?.trim().toLowerCase();
  if (configured === "none" || configured === "essential") return configured;
  return "extended";
}

async function readEvents(path: string | null): Promise<AnalyticsEvent[]> {
  if (!path) return [];
  try {
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(path));
    return Array.isArray(parsed) ? (parsed as AnalyticsEvent[]) : [];
  } catch {
    return [];
  }
}

async function writeEvents(path: string | null, events: AnalyticsEvent[]): Promise<void> {
  if (!path || !ANALYTICS_DIR) return;
  await FileSystem.makeDirectoryAsync(ANALYTICS_DIR, { intermediates: true });
  const temporaryPath = `${path}.tmp`;
  await FileSystem.writeAsStringAsync(temporaryPath, JSON.stringify(events));
  await FileSystem.deleteAsync(path, { idempotent: true });
  await FileSystem.moveAsync({ from: temporaryPath, to: path });
}

async function loadQueue(): Promise<AnalyticsEvent[]> {
  if (!queue) queue = await readEvents(QUEUE_FILE);
  return queue;
}

function serialize(operation: () => Promise<void>): Promise<void> {
  const pending = mutation.then(operation, operation);
  mutation = pending.catch(() => {});
  return pending;
}

function freshEvents(events: AnalyticsEvent[]): AnalyticsEvent[] {
  const cutoff = Date.now() - EVENT_TTL_MS;
  return events.filter((event) => {
    const occurredAt = Date.parse(event.occurredAt);
    return Number.isFinite(occurredAt) && occurredAt >= cutoff;
  });
}

async function quarantine(events: AnalyticsEvent[]): Promise<void> {
  if (!events.length) return;
  const existing = await readEvents(QUARANTINE_FILE);
  await writeEvents(QUARANTINE_FILE, [...existing, ...events].slice(-QUARANTINE_LIMIT));
}

export function recordTelemetry(
  name: AnalyticsEventName,
  properties: Record<string, SafeAnalyticsValue> = {},
): void {
  const tier = analyticsTier();
  if (tier === "none" || (tier === "essential" && !isEssentialAnalyticsEvent(name))) return;
  const event: AnalyticsEvent = {
    eventId: Crypto.randomUUID(),
    name,
    occurredAt: new Date().toISOString(),
    sessionId,
    properties: sanitizeAnalyticsProperties(name, properties),
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
  };
  void serialize(async () => {
    const current = freshEvents(await loadQueue());
    queue = [...current, event].slice(-QUEUE_LIMIT);
    await writeEvents(QUEUE_FILE, queue);
  });
}

export async function flushTelemetry(): Promise<void> {
  if (flushing || analyticsTier() === "none") return;
  flushing = true;
  try {
    await mutation;
    const current = freshEvents(await loadQueue());
    if (current.length !== queue?.length) {
      queue = current;
      await writeEvents(QUEUE_FILE, current);
    }
    const batch = current.slice(0, BATCH_LIMIT);
    if (!batch.length) return;
    const response = await narraGatewayRequest("/v2/events/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: batch }),
    });
    if (!response.ok) {
      if (response.status !== 400) return;
      await quarantine(batch);
    } else {
      const result = (await response.json().catch(() => null)) as {
        accepted?: number;
        rejected?: Array<{ event_id?: string }>;
      } | null;
      if (
        typeof result?.accepted !== "number" ||
        result.accepted + (result.rejected?.length ?? 0) !== batch.length
      ) {
        return;
      }
      const rejectedIds = new Set(
        (result?.rejected ?? []).map((item) => item.event_id).filter(Boolean),
      );
      await quarantine(batch.filter((event) => rejectedIds.has(event.eventId)));
    }
    const attemptedIds = new Set(batch.map((event) => event.eventId));
    await serialize(async () => {
      const latest = freshEvents(await loadQueue());
      queue = latest.filter((event) => !attemptedIds.has(event.eventId));
      await writeEvents(QUEUE_FILE, queue);
    });
  } catch {
    // Delivery is best-effort. The persisted queue is retried on the next
    // lifecycle transition or interval; product flows must never depend on it.
  } finally {
    flushing = false;
  }
}

function appVersion(): string {
  return Constants.expoConfig?.version?.replace(/[^A-Za-z0-9_.+-]/g, "").slice(0, 80) || "unknown";
}

function openSession(): void {
  if (active) return;
  active = true;
  activeSince = Date.now();
  sessionId = Crypto.randomUUID();
  const osMajor = String(Platform.Version).match(/^\d{1,3}/)?.[0];
  recordTelemetry("app_opened", {
    app_version: appVersion(),
    channel: __DEV__ ? "development" : "production",
    ...(osMajor ? { os_major: osMajor } : {}),
  });
  recordTelemetry("app_version_seen", { version: appVersion() });
  void flushTelemetry();
}

function closeSession(): void {
  if (!active) return;
  active = false;
  recordTelemetry("app_closed", {
    duration_seconds: Math.max(0, Math.round((Date.now() - activeSince) / 1_000)),
  });
  void flushTelemetry();
}

function handleAppState(next: AppStateStatus): void {
  if (next === "active") openSession();
  else closeSession();
}

export function startTelemetry(): () => void {
  if (!interval) interval = setInterval(() => void flushTelemetry(), FLUSH_INTERVAL_MS);
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener("change", handleAppState);
  }
  if (productUnsubscribers.length === 0) {
    productUnsubscribers = [
      eventBus.on("annotation:added", ({ type }) => {
        if (type === "bookmark") recordTelemetry("bookmark_added", { feature: "bookmark" });
        if (type === "note") recordTelemetry("note_added", { feature: "note" });
      }),
    ];
  }
  if (AppState.currentState === "active") openSession();
  return stopTelemetry;
}

export function stopTelemetry(): void {
  closeSession();
  if (interval) clearInterval(interval);
  interval = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
  for (const unsubscribe of productUnsubscribers) unsubscribe();
  productUnsubscribers = [];
}

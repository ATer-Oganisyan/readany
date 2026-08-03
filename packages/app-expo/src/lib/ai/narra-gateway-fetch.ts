import { NarraServiceError } from "@/lib/narra/errors";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const INSTALLATION_ID_KEY = "narra.gateway.installation-id";
const INSTALLATION_SECRET_KEY = "narra.gateway.installation-secret";
const TOKEN_EXPIRY_SKEW_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 60_000;

type NarraGatewayAdapter = (path: string, init: RequestInit) => Promise<Response>;

interface InstallationIdentity {
  installationId: string;
  installationSecret: string;
}

interface GatewayToken {
  value: string;
  expiresAt: number;
}

let configuredAdapter: NarraGatewayAdapter | null = null;
let configuredFetch: typeof globalThis.fetch = globalThis.fetch;
let cachedIdentity: InstallationIdentity | null = null;
let cachedToken: GatewayToken | null = null;
let tokenPromise: Promise<string> | null = null;

export interface NarraGatewayConfig {
  baseUrl: string;
  authMode: "none" | "installation";
}

export function getNarraGatewayConfig(): NarraGatewayConfig {
  const baseUrl = process.env.EXPO_PUBLIC_NARRA_GATEWAY_URL?.trim().replace(/\/+$/, "") ?? "";
  const authMode =
    process.env.EXPO_PUBLIC_NARRA_GATEWAY_AUTH_MODE === "installation" ? "installation" : "none";
  return { baseUrl, authMode };
}

/** Allows a host app or test to provide the backend contract without patching global fetch. */
export function setNarraGatewayAdapter(adapter: NarraGatewayAdapter | null): void {
  configuredAdapter = adapter;
}

export function setNarraGatewayFetch(fetchImpl: typeof globalThis.fetch): void {
  configuredFetch = fetchImpl;
}

function requireGatewayUrl(): string {
  const { baseUrl } = getNarraGatewayConfig();
  if (!baseUrl) {
    throw new NarraServiceError(
      "CONFIG",
      "EXPO_PUBLIC_NARRA_GATEWAY_URL is not configured for this build",
    );
  }
  return baseUrl;
}

function base64Url(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const value = (a << 16) | (b << 8) | c;
    output += alphabet[(value >> 18) & 63];
    output += alphabet[(value >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(value >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[value & 63] : "=";
  }
  return output.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getInstallationIdentity(): Promise<InstallationIdentity> {
  if (cachedIdentity) return cachedIdentity;
  let installationId = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  let installationSecret = await SecureStore.getItemAsync(INSTALLATION_SECRET_KEY);
  if (!installationId || !installationSecret) {
    installationId = Crypto.randomUUID();
    installationSecret = base64Url(await Crypto.getRandomBytesAsync(32));
    await Promise.all([
      SecureStore.setItemAsync(INSTALLATION_ID_KEY, installationId),
      SecureStore.setItemAsync(INSTALLATION_SECRET_KEY, installationSecret),
    ]);
  }
  cachedIdentity = { installationId, installationSecret };
  return cachedIdentity;
}

async function readGatewayError(response: Response): Promise<string> {
  const payload = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: string; message?: string; code?: string } | null;
  return payload?.error || payload?.message || payload?.code || `HTTP ${response.status}`;
}

async function requestInstallationToken(mode: "register" | "refresh"): Promise<string> {
  const identity = await getInstallationIdentity();
  const response = await configuredFetch(`${requireGatewayUrl()}/v2/installations/${mode}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      mode === "register"
        ? {
            installation_id: identity.installationId,
            installation_secret: identity.installationSecret,
            app_version: "narra-expo",
            platform: process.env.EXPO_OS || "react-native",
            arch: "react-native",
          }
        : {
            installation_id: identity.installationId,
            installation_secret: identity.installationSecret,
          },
    ),
  });
  if (!response.ok) {
    if (mode === "refresh" && response.status === 404) return requestInstallationToken("register");
    throw new NarraServiceError("AUTH", await readGatewayError(response));
  }
  const payload = (await response.json()) as { token?: string; expires_in?: number };
  if (!payload.token) throw new NarraServiceError("AUTH", "Gateway returned no token");
  cachedToken = {
    value: payload.token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 900) * 1000,
  };
  return payload.token;
}

async function getInstallationToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
    return cachedToken.value;
  }
  if (!tokenPromise) {
    tokenPromise = requestInstallationToken(
      cachedToken || forceRefresh ? "refresh" : "register",
    ).finally(() => {
      tokenPromise = null;
    });
  }
  return tokenPromise;
}

async function directGatewayRequest(path: string, init: RequestInit): Promise<Response> {
  const config = getNarraGatewayConfig();
  const url = `${requireGatewayUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const send = async (forceRefresh = false) => {
    const headers = new Headers(init.headers);
    if (config.authMode === "installation") {
      headers.set("authorization", `Bearer ${await getInstallationToken(forceRefresh)}`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      return await configuredFetch(url, { ...init, headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };
  let response = await send();
  if (config.authMode === "installation" && response.status === 401) response = await send(true);
  return response;
}

export async function narraGatewayRequest(path: string, init: RequestInit = {}): Promise<Response> {
  return configuredAdapter ? configuredAdapter(path, init) : directGatewayRequest(path, init);
}

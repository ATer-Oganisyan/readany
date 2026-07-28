import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const DEFAULT_GATEWAY_URL = "https://narra-proxy-production.up.railway.app";
const INSTALLATION_ID_KEY = "narra.gateway.installation-id";
const INSTALLATION_SECRET_KEY = "narra.gateway.installation-secret";
const TOKEN_EXPIRY_SKEW_MS = 30_000;

interface InstallationIdentity {
  installationId: string;
  installationSecret: string;
}

interface GatewayToken {
  value: string;
  expiresAt: number;
}

interface OpenAIMessage {
  role?: string;
  content?: unknown;
}

let cachedIdentity: InstallationIdentity | null = null;
let cachedToken: GatewayToken | null = null;
let tokenPromise: Promise<string> | null = null;

function gatewayUrl(): string {
  return (process.env.EXPO_PUBLIC_NARRA_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL).replace(
    /\/+$/,
    "",
  );
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

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function requestToken(
  fetchImpl: typeof globalThis.fetch,
  mode: "register" | "refresh",
): Promise<string> {
  const identity = await getInstallationIdentity();
  const body =
    mode === "register"
      ? {
          installation_id: identity.installationId,
          installation_secret: identity.installationSecret,
          app_version: "1.3.5-narra",
          platform: Platform.OS,
          arch: "react-native",
        }
      : {
          installation_id: identity.installationId,
          installation_secret: identity.installationSecret,
        };
  const response = await fetchImpl(`${gatewayUrl()}/v2/installations/${mode}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (mode === "refresh" && response.status === 404) {
      return requestToken(fetchImpl, "register");
    }
    throw new Error(`Narra gateway authorization failed: ${await readError(response)}`);
  }

  const payload = (await response.json()) as { token: string; expires_in?: number };
  const ttlMs = Math.max(60, payload.expires_in ?? 900) * 1000;
  cachedToken = { value: payload.token, expiresAt: Date.now() + ttlMs };
  return payload.token;
}

async function getToken(fetchImpl: typeof globalThis.fetch, forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
    return cachedToken.value;
  }
  if (!tokenPromise) {
    tokenPromise = requestToken(
      fetchImpl,
      cachedToken || forceRefresh ? "refresh" : "register",
    ).finally(() => {
      tokenPromise = null;
    });
  }
  return tokenPromise;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isNarraRequest(url: string): boolean {
  try {
    const candidate = new URL(url);
    const gateway = new URL(gatewayUrl());
    return (
      candidate.origin === gateway.origin &&
      /^\/v1\/(chat\/completions|models)\/?$/.test(candidate.pathname)
    );
  } catch {
    return false;
  }
}

function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeMessages(messages: OpenAIMessage[]): Array<{ role: string; content: string }> {
  return messages
    .map((message) => ({
      role: ["system", "user", "assistant"].includes(message.role || "")
        ? (message.role as string)
        : "user",
      content: contentToString(message.content),
    }))
    .filter((message) => message.content.length > 0)
    .slice(-64);
}

function inferPurpose(messages: OpenAIMessage[], stream: boolean) {
  const text = messages.map((message) => contentToString(message.content)).join("\n").toLowerCase();
  if (/summar|summary|резюм|кратк|итог/.test(text)) return "summary";
  if (/memory|remember|памят|вспомн/.test(text)) return "memory";
  if (/scenario|сценар/.test(text)) return "scenario";
  return stream ? "character_chat" : "structured_task";
}

function openAICompletion(text: string, model: string, requestId?: string): Response {
  return new Response(
    JSON.stringify({
      id: requestId || Crypto.randomUUID(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function readRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === "string") return init.body;
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.clone().text();
  }
  return "";
}

export function createNarraGatewayFetch(
  fetchImpl: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!isNarraRequest(url)) return fetchImpl(input, init);

    if (/\/models\/?$/.test(new URL(url).pathname)) {
      return new Response(
        JSON.stringify({ object: "list", data: [{ id: "narra", object: "model" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    const original = JSON.parse(await readRequestBody(input, init)) as {
      messages?: OpenAIMessage[];
      temperature?: number;
      stream?: boolean;
      model?: string;
    };
    const stream = Boolean(original.stream);
    const gatewayBody = JSON.stringify({
      messages: normalizeMessages(original.messages || []),
      temperature: original.temperature,
      purpose: inferPurpose(original.messages || [], stream),
      origin: "user",
      analytics_tier: "essential",
    });

    const send = async (forceRefresh = false) => {
      const token = await getToken(fetchImpl, forceRefresh);
      return fetchImpl(`${gatewayUrl()}/v2/ai/chat/${stream ? "stream" : "complete"}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: gatewayBody,
        signal: init?.signal,
      });
    };

    let response = await send();
    if (response.status === 401) response = await send(true);
    if (!response.ok || stream) return response;

    const payload = (await response.json()) as { text?: string; request_id?: string };
    return openAICompletion(payload.text || "", original.model || "narra", payload.request_id);
  }) as typeof globalThis.fetch;
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const secureValues = vi.hoisted(() => new Map<string, string>());
const secureStore = vi.hoisted(() => ({
  deleteItemAsync: vi.fn(async (key: string) => {
    secureValues.delete(key);
  }),
  getItemAsync: vi.fn(async (key: string) => secureValues.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureValues.set(key, value);
  }),
}));
const cryptoMock = vi.hoisted(() => ({
  getRandomBytesAsync: vi.fn(async () => new Uint8Array(32).fill(7)),
  randomUUID: vi.fn(() => "22222222-2222-4222-8222-222222222222"),
}));

vi.mock("expo-secure-store", () => secureStore);
vi.mock("expo-crypto", () => cryptoMock);
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

const INSTALLATION_ID_KEY = "narra.gateway.installation-id";
const INSTALLATION_SECRET_KEY = "narra.gateway.installation-secret";

function jsonResponse(status: number, payload: object): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function expoJsonResponse(status: number, payload: object): Response {
  const response = jsonResponse(status, payload);
  Object.defineProperty(response, "clone", {
    value: () => {
      throw new Error("Not implemented");
    },
  });
  return response;
}

describe("Narra gateway installation recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    secureValues.clear();
    process.env.EXPO_PUBLIC_NARRA_GATEWAY_URL = "https://gateway.test";
    process.env.EXPO_PUBLIC_NARRA_GATEWAY_AUTH_MODE = "installation";
  });

  it("replaces a rejected persisted identity and retries the request once", async () => {
    secureValues.set(INSTALLATION_ID_KEY, "11111111-1111-4111-8111-111111111111");
    secureValues.set(INSTALLATION_SECRET_KEY, "stale-secret");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(403, { code: "AUTH", error: "Installation proof отклонён" }),
      )
      .mockResolvedValueOnce(jsonResponse(201, { token: "fresh-token", expires_in: 900 }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const gateway = await import("./narra-gateway-fetch");
    gateway.setNarraGatewayFetch(fetchMock);

    const response = await gateway.narraGatewayRequest("/v2/media/images", { method: "POST" });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(INSTALLATION_ID_KEY);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(INSTALLATION_SECRET_KEY);
    const replacementRegistration = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(replacementRegistration.installation_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("authorization")).toBe(
      "Bearer fresh-token",
    );
  });

  it("recovers when a previously valid token can no longer be refreshed", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(201, { token: "first-token", expires_in: 900 }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(
        jsonResponse(401, { code: "AUTH", error: "Нужен действующий installation token" }),
      )
      .mockResolvedValueOnce(
        jsonResponse(403, { code: "AUTH", error: "Installation proof отклонён" }),
      )
      .mockResolvedValueOnce(jsonResponse(201, { token: "second-token", expires_in: 900 }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const gateway = await import("./narra-gateway-fetch");
    gateway.setNarraGatewayFetch(fetchMock);

    await gateway.narraGatewayRequest("/v2/media/images", { method: "POST" });
    const response = await gateway.narraGatewayRequest("/v2/media/images", { method: "POST" });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[5]?.[1]?.headers).get("authorization")).toBe(
      "Bearer second-token",
    );
  });

  it("uses the gateway auth header when the human-readable error text changes", async () => {
    const tokenRejection = jsonResponse(401, {
      code: "AUTH",
      error: "Token expired",
    });
    tokenRejection.headers.set("x-narra-auth-error", "installation_token");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(201, { token: "first-token", expires_in: 900 }))
      .mockResolvedValueOnce(tokenRejection)
      .mockResolvedValueOnce(jsonResponse(201, { token: "second-token", expires_in: 900 }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const gateway = await import("./narra-gateway-fetch");
    gateway.setNarraGatewayFetch(fetchMock);

    const response = await gateway.narraGatewayRequest("/v2/media/images", { method: "POST" });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get("authorization")).toBe(
      "Bearer second-token",
    );
  });

  it("does not keep rotating identities after the recovery attempt fails", async () => {
    secureValues.set(INSTALLATION_ID_KEY, "11111111-1111-4111-8111-111111111111");
    secureValues.set(INSTALLATION_SECRET_KEY, "stale-secret");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(403, { code: "AUTH", error: "Installation proof отклонён" }),
      )
      .mockResolvedValueOnce(
        jsonResponse(403, { code: "AUTH", error: "Installation proof отклонён" }),
      );
    const gateway = await import("./narra-gateway-fetch");
    gateway.setNarraGatewayFetch(fetchMock);

    await expect(
      gateway.narraGatewayRequest("/v2/media/images", { method: "POST" }),
    ).rejects.toMatchObject({ code: "AUTH" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
  });

  it("does not replace a revoked installation", async () => {
    secureValues.set(INSTALLATION_ID_KEY, "11111111-1111-4111-8111-111111111111");
    secureValues.set(INSTALLATION_SECRET_KEY, "revoked-secret");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(403, { code: "AUTH", error: "Эта установка отозвана" }));
    const gateway = await import("./narra-gateway-fetch");
    gateway.setNarraGatewayFetch(fetchMock);

    await expect(
      gateway.narraGatewayRequest("/v2/media/images", { method: "POST" }),
    ).rejects.toMatchObject({ code: "AUTH" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("does not retry a provider authorization failure as an installation failure", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(201, { token: "valid-token", expires_in: 900 }))
      .mockResolvedValueOnce(
        expoJsonResponse(401, {
          code: "AUTH",
          error: "Провайдер изображений отклонил ключ",
        }),
      );
    const gateway = await import("./narra-gateway-fetch");
    gateway.setNarraGatewayFetch(fetchMock);

    const response = await gateway.narraGatewayRequest("/v2/media/images", { method: "POST" });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH",
      error: "Провайдер изображений отклонил ключ",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});

describe("Narra gateway build configuration", () => {
  it("uses the production gateway when a native build has no Expo environment", async () => {
    vi.resetModules();
    process.env.EXPO_PUBLIC_NARRA_GATEWAY_URL = "";
    process.env.EXPO_PUBLIC_NARRA_GATEWAY_AUTH_MODE = "";

    const gateway = await import("./narra-gateway-fetch");

    expect(gateway.getNarraGatewayConfig()).toEqual({
      baseUrl: "https://api.narra.disrupt.builders",
      authMode: "installation",
    });
  });
});

describe("Narra logical request identity", () => {
  it("adds one opaque request id before a request reaches an adapter", async () => {
    vi.resetModules();
    const gateway = await import("./narra-gateway-fetch");
    const adapter = vi.fn(async (_path: string, _init: RequestInit) =>
      jsonResponse(200, { ok: true }),
    );
    gateway.setNarraGatewayAdapter(adapter);

    await gateway.narraGatewayRequest("/v2/ai/chat/complete", {
      method: "POST",
      body: JSON.stringify({ purpose: "summary", messages: [] }),
    });

    const payload = JSON.parse(String(adapter.mock.calls[0]?.[1]?.body));
    expect(payload.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

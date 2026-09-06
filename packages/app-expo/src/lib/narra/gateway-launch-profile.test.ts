import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEffectiveNarraGatewayProfile } from "../ai/narra-gateway-config";
import { localNarraGatewayScope } from "../ai/narra-gateway-scope";

beforeEach(() => {
  for (const name of [
    "GATEWAY_URL",
    "ENVIRONMENT",
    "GATEWAY_AUTH_MODE",
    "LAUNCH_GATEWAY_URL",
    "LAUNCH_ENVIRONMENT",
    "LAUNCH_AUTH_MODE",
  ])
    vi.stubEnv(`EXPO_PUBLIC_NARRA_${name}`, undefined);
});
afterEach(() => vi.unstubAllEnvs());
describe("atomic launcher gateway profile", () => {
  it("retains no-launch TEST defaults and production pinning", () => {
    expect(getEffectiveNarraGatewayProfile()).toEqual({
      baseUrl: "https://api-test.narra.disrupt.builders",
      authMode: "installation",
      environment: "unknown",
    });
    vi.stubEnv("EXPO_PUBLIC_NARRA_ENVIRONMENT", "production");
    vi.stubEnv("EXPO_PUBLIC_NARRA_GATEWAY_URL", "http://127.0.0.1:18787");
    expect(getEffectiveNarraGatewayProfile().baseUrl).toBe("https://api.narra.disrupt.builders");
  });
  it("uses LOCAL launch for URL, environment and credential scope above TEST dotenv", () => {
    vi.stubEnv("EXPO_PUBLIC_NARRA_ENVIRONMENT", "test");
    vi.stubEnv("EXPO_PUBLIC_NARRA_GATEWAY_URL", "https://api-test.narra.disrupt.builders");
    vi.stubEnv("EXPO_PUBLIC_NARRA_GATEWAY_AUTH_MODE", "none");
    vi.stubEnv("EXPO_PUBLIC_NARRA_LAUNCH_GATEWAY_URL", "http://127.0.0.1:18787/");
    vi.stubEnv("EXPO_PUBLIC_NARRA_LAUNCH_ENVIRONMENT", "development");
    const profile = getEffectiveNarraGatewayProfile();
    expect(profile).toEqual({
      baseUrl: "http://127.0.0.1:18787",
      environment: "development",
      authMode: "installation",
    });
    expect(localNarraGatewayScope(profile.baseUrl)).toBe(
      "687474703a2f2f3132372e302e302e313a3138373837",
    );
  });
  it.each<Record<string, string>>([
    { LAUNCH_GATEWAY_URL: "http://127.0.0.1:18787" },
    { LAUNCH_ENVIRONMENT: "development" },
    { LAUNCH_AUTH_MODE: "none" },
    { LAUNCH_GATEWAY_URL: "http://127.0.0.1:18787", LAUNCH_ENVIRONMENT: "production" },
    { LAUNCH_GATEWAY_URL: "http://api.narra.disrupt.builders", LAUNCH_ENVIRONMENT: "production" },
    { LAUNCH_GATEWAY_URL: "https://wrong.example", LAUNCH_ENVIRONMENT: "production" },
    { LAUNCH_GATEWAY_URL: "http://127.0.0.1:18787", LAUNCH_ENVIRONMENT: "invalid" },
    { LAUNCH_GATEWAY_URL: "http://secret@127.0.0.1:18787", LAUNCH_ENVIRONMENT: "development" },
    { LAUNCH_GATEWAY_URL: "file:///tmp", LAUNCH_ENVIRONMENT: "development" },
    {
      LAUNCH_GATEWAY_URL: "http://127.0.0.1:18787",
      LAUNCH_ENVIRONMENT: "development",
      LAUNCH_AUTH_MODE: "invalid",
    },
  ])("rejects partial or invalid overrides without dotenv fallback %j", (env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(`EXPO_PUBLIC_NARRA_${key}`, value);
    expect(getEffectiveNarraGatewayProfile).toThrow("NARRA_LAUNCH_PROFILE_INVALID");
  });
});

import { describe, expect, it, vi } from "vitest";
import { localNarraGatewayScope } from "../ai/narra-gateway-scope";
const config = vi.hoisted(() => ({ baseUrl: "http://127.0.0.1:18787" }));
vi.mock("../ai/narra-gateway-fetch", () => ({ getNarraGatewayConfig: () => config }));
import { backendCacheRoot } from "./backend-cache-scope";

describe("stable LOCAL gateway namespace", () => {
  it("keeps long LOCAL URL prefixes within filesystem component limits", () => {
    config.baseUrl = `http://127.0.0.1:18787/${"a".repeat(160)}`;
    const root = backendCacheRoot("file:///documents/cache");
    const parts = root.split("/local/")[1].split("/");
    expect(parts.every((part) => part.length <= 240)).toBe(true);
    expect(parts.join("")).toBe(localNarraGatewayScope(config.baseUrl));
  });
  it("joins native directory URIs without double slashes and preserves remote bytes", () => {
    config.baseUrl = "http://127.0.0.1:18787";
    expect(backendCacheRoot("file:///documents/narra-media/")).toBe(
      backendCacheRoot("file:///documents/narra-media"),
    );
    config.baseUrl = "https://api-test.narra.disrupt.builders";
    expect(backendCacheRoot("file:///documents/narra-media/")).toBe(
      "file:///documents/narra-media/",
    );
  });
  it("retains exact pre-existing credential scope bytes", () => {
    expect(localNarraGatewayScope("http://127.0.0.1:18787")).toBe(
      "687474703a2f2f3132372e302e302e313a3138373837",
    );
    expect(
      localNarraGatewayScope("http://user:secret@127.0.0.1:18787///?token=secret#fragment"),
    ).toBe("687474703a2f2f3132372e302e302e313a3138373837");
  });
  it("leaves remote installations unchanged", () => {
    for (const url of [
      "https://api-test.narra.disrupt.builders",
      "https://api.narra.disrupt.builders",
    ]) {
      expect(localNarraGatewayScope(url)).toBeUndefined();
    }
  });
  it("canonicalizes default port and trailing slash without conflating endpoints", () => {
    expect(localNarraGatewayScope("http://localhost:80/api///")).toBe(
      localNarraGatewayScope("http://localhost/api"),
    );
    const scopes = [
      "http://localhost/api",
      "http://localhost/other",
      "http://localhost:81/api",
      "http://127.0.0.1/api",
      "http://[::1]/api",
      "http://10.0.2.2/api",
    ].map(localNarraGatewayScope);
    expect(scopes.every(Boolean)).toBe(true);
    expect(new Set(scopes).size).toBe(scopes.length);
  });
});

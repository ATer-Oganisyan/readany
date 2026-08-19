import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayRequest = vi.hoisted(() => vi.fn());

vi.mock("../ai/narra-gateway-fetch", () => ({ narraGatewayRequest: gatewayRequest }));

describe("Gateway-backed fanfic source fetch", () => {
  beforeEach(() => gatewayRequest.mockReset());

  it("encodes the source URL and never contacts the source directly", async () => {
    gatewayRequest.mockResolvedValue(new Response("ok", { status: 200 }));
    const { gatewayImportSourceFetch } = await import("./import-source-gateway");

    const response = await gatewayImportSourceFetch(
      "https://archiveofourown.org/?ref=website-popularity",
    );

    expect(await response.text()).toBe("ok");
    expect(gatewayRequest).toHaveBeenCalledWith(
      "/v2/import/fetch?url=https%3A%2F%2Farchiveofourown.org%2F%3Fref%3Dwebsite-popularity",
      { method: "GET" },
    );
  });
});

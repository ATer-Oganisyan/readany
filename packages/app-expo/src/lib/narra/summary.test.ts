import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateNarraSummary } from "./summary";

vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ narraGatewayRequest: vi.fn() }));

describe("Narra summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests a spoiler-safe summary for the selected excerpt", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "Герои встречаются у окна." }), { status: 200 }),
    );

    await expect(generateNarraSummary("Глава 1", "Герои встретились у окна.")).resolves.toBe(
      "Герои встречаются у окна.",
    );

    const [path, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    expect(path).toBe("/v2/ai/chat/complete");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      purpose: "summary",
      messages: [
        { role: "system" },
        { role: "user", content: "Глава «Глава 1»:\nГерои встретились у окна." },
      ],
    });
  });

  it("rejects an empty completion", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "" }), { status: 200 }),
    );

    await expect(generateNarraSummary("Глава", "Текст")).rejects.toThrow(
      "Gateway returned an empty summary",
    );
  });
});

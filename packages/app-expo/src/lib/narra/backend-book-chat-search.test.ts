import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBackendBookChatToolProvider } from "./backend-book-chat-search";

vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ narraGatewayRequest: vi.fn() }));

const BOOK_EDITION_ID = "fee4e34b-0e3c-4661-bf00-5bb46c7f3a0d";

function graphResponse() {
  return new Response(
    JSON.stringify({
      contract_version: "book-graph-search-v1",
      book_edition_id: BOOK_EDITION_ID,
      query: "Prometheus",
      requested_mode: "semantic",
      effective_mode: "semantic",
      spoiler_mode: "reader",
      max_text_offset: 20_000,
      max_hops: 2,
      state: "story_arcs_ready",
      content_results: [{ snippet: "Prometheus is bound", end_text_offset: 3_000 }],
      nodes: [{ canonical_name: "Prometheus", last_evidence_text_offset: 3_100 }],
      edges: [{ label: "is bound by", evidence_end_text_offset: 3_200 }],
      story_arcs: [{ title: "Binding of Prometheus", evidence_end_text_offset: 3_300 }],
      evidence: [{ fact: "Prometheus is bound", end_text_offset: 3_000 }],
    }),
  );
}

describe("backend book chat search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("replaces local ragSearch with authenticated spoiler-safe graph retrieval", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(graphResponse());
    const provider = createBackendBookChatToolProvider({
      bookEditionId: BOOK_EDITION_ID,
      localBookIsVectorized: true,
    });
    const tools = provider({
      bookId: "local-book-id",
      isVectorized: true,
      enabledSkills: [],
      spoilerFree: true,
    });
    const searchTools = tools.filter((tool) => tool.name === "ragSearch");

    expect(searchTools).toHaveLength(1);
    expect(tools.some((tool) => tool.name === "addCitation")).toBe(false);
    expect(tools.some((tool) => tool.name === "ragToc" || tool.name === "ragContext")).toBe(false);
    await expect(
      searchTools[0]?.execute({ query: "Prometheus", mode: "vector", topK: 7 }),
    ).resolves.toEqual(
      expect.objectContaining({
        source: "narra-backend-graph-rag",
        bookId: "local-book-id",
        bookEditionId: BOOK_EDITION_ID,
        spoilerMode: "reader",
        storyArcs: [expect.objectContaining({ title: "Binding of Prometheus" })],
        evidence: [expect.objectContaining({ fact: "Prometheus is bound" })],
      }),
    );
    expect(vi.mocked(narraGatewayRequest)).toHaveBeenCalledWith(
      `/v2/books/${BOOK_EDITION_ID}/graph/search?q=Prometheus&mode=semantic&spoiler_mode=reader&limit=7&max_hops=2`,
      {},
    );
  });

  it("uses backend retrieval without slow local content or citation tools", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...JSON.parse(await graphResponse().text()),
          requested_mode: "hybrid",
          effective_mode: "hybrid",
          spoiler_mode: "full",
          max_text_offset: 161_830,
        }),
      ),
    );
    const provider = createBackendBookChatToolProvider({
      bookEditionId: BOOK_EDITION_ID,
      localBookIsVectorized: false,
    });
    const tools = provider({
      bookId: "local-book-id",
      isVectorized: true,
      enabledSkills: [],
      spoilerFree: false,
    });
    const search = tools.find((tool) => tool.name === "ragSearch");

    expect(search).toBeDefined();
    expect(tools.some((tool) => tool.name.startsWith("fallback"))).toBe(false);
    expect(tools.some((tool) => tool.name === "addCitation")).toBe(false);
    expect(tools.some((tool) => tool.name === "ragToc" || tool.name === "ragContext")).toBe(false);
    await expect(search?.execute({ query: "Prometheus" })).resolves.toEqual(
      expect.objectContaining({
        instruction: expect.stringContaining("Do not call more retrieval or citation tools"),
      }),
    );
    expect(vi.mocked(narraGatewayRequest)).toHaveBeenCalledWith(
      `/v2/books/${BOOK_EDITION_ID}/graph/search?q=Prometheus&mode=hybrid&spoiler_mode=full&limit=8&max_hops=2`,
      {},
    );
  });
});

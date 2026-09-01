import {
  BackendBookError,
  backendBookPath,
  backendBookRequest,
} from "@/lib/narra/backend-book-api";
import { type ToolDefinition, getAvailableTools } from "@readany/core/ai/tools";
import type { Skill } from "@readany/core/types";
import type { NarraChatPath } from "./narra-chat-routing";

interface BackendSearchResult {
  chunkId: string;
  chapterKey: string;
  score: number;
  matchedBy: string[];
  startTextOffset: number;
  endTextOffset: number;
  content: string;
}

interface BackendSearchResponse {
  effectiveMode: string;
  results: BackendSearchResult[];
}

type BackendRequest = typeof backendBookRequest;

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseBackendSearch(payload: Record<string, unknown>): BackendSearchResponse {
  const rows = Array.isArray(payload.results) ? payload.results : [];
  return {
    effectiveMode: typeof payload.effective_mode === "string" ? payload.effective_mode : "lexical",
    results: rows.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const row = candidate as Record<string, unknown>;
      if (typeof row.snippet !== "string" || !row.snippet.trim()) return [];
      return [
        {
          chunkId: typeof row.chunk_id === "string" ? row.chunk_id : "",
          chapterKey: typeof row.chapter_key === "string" ? row.chapter_key : "",
          score: finiteNumber(row.score),
          matchedBy: Array.isArray(row.matched_by)
            ? row.matched_by.filter((item): item is string => typeof item === "string")
            : [],
          startTextOffset: finiteNumber(row.start_text_offset),
          endTextOffset: finiteNumber(row.end_text_offset),
          content: row.snippet,
        },
      ];
    }),
  };
}

function mayFallbackToOriginalFile(error: unknown): boolean {
  if (!(error instanceof BackendBookError)) return true;
  return ![400, 401, 403].includes(error.status);
}

export function createBackendBookSearchTool(options: {
  bookEditionId: string;
  spoilerFree: boolean | (() => boolean);
  fallbackSearch: ToolDefinition["execute"];
  fallbackPath?: NarraChatPath;
  onPath: (path: NarraChatPath) => void;
  request?: BackendRequest;
}): ToolDefinition {
  const request = options.request ?? backendBookRequest;
  const fallbackPath = options.fallbackPath ?? "proxy-fallback";
  return {
    name: "ragSearch",
    description:
      "Search the server-side Narra index for this book. This is the preferred semantic/lexical retrieval path. If the server index is not ready, the tool automatically uses an existing local index or searches the original book file.",
    parameters: {
      query: {
        type: "string",
        description: "The search query describing what to find",
        required: true,
      },
      mode: {
        type: "string",
        description: 'Search mode: "hybrid" (recommended), "semantic", or "lexical"',
      },
      topK: { type: "number", description: "Number of results to return (default: 5)" },
    },
    execute: async (args) => {
      const query = String(args.query || "").trim();
      const topK = Math.max(1, Math.min(20, Number(args.topK) || 5));
      if (query.length < 2) {
        options.onPath(fallbackPath);
        return options.fallbackSearch({ query, topK });
      }
      const requestedMode = ["lexical", "semantic", "hybrid"].includes(String(args.mode))
        ? String(args.mode)
        : "hybrid";
      const params = new URLSearchParams({
        q: query,
        mode: requestedMode,
        spoiler_mode: (
          typeof options.spoilerFree === "function"
            ? options.spoilerFree()
            : options.spoilerFree
        )
          ? "reader"
          : "full",
        limit: String(topK),
      });

      try {
        const payload = await request(
          `${backendBookPath(options.bookEditionId, "search")}?${params.toString()}`,
        );
        const parsed = parseBackendSearch(payload);
        options.onPath("index");
        return {
          query,
          source: "narra-server-index",
          effectiveMode: parsed.effectiveMode,
          results: parsed.results,
          totalResults: parsed.results.length,
          instruction:
            "Use these server-index snippets as book evidence. They have stable text offsets but no EPUB CFI; cite chapterKey and quoted text in the answer, and do not call addCitation unless another tool supplies a non-empty CFI.",
        };
      } catch (error) {
        if (!mayFallbackToOriginalFile(error)) throw error;
        options.onPath(fallbackPath);
        const fallback = await options.fallbackSearch({ query, topK });
        return fallback && typeof fallback === "object"
          ? { ...(fallback as Record<string, unknown>), retrievalPath: fallbackPath }
          : fallback;
      }
    },
  };
}

export function createNarraIndexedToolProvider(options: {
  bookId: string;
  bookEditionId: string;
  spoilerFree: boolean | (() => boolean);
  hasLocalIndex?: boolean;
  onPath: (path: NarraChatPath) => void;
  request?: BackendRequest;
}): (input: {
  bookId: string | null;
  isVectorized: boolean;
  enabledSkills: Skill[];
}) => ToolDefinition[] {
  return (input) => {
    // Existing local-index or original-file tools are kept as the deterministic
    // fallback. The server search tool is presented as ragSearch so the existing
    // Reading Agent prioritizes it for indexed book questions.
    const tools = getAvailableTools({ ...input, isVectorized: options.hasLocalIndex === true });
    if (input.bookId !== options.bookId) return tools;
    const localRagSearch = tools.find((tool) => tool.name === "ragSearch");
    const fallbackSearch = localRagSearch ?? tools.find((tool) => tool.name === "fallbackSearch");
    if (!fallbackSearch) return tools;
    return [
      ...tools.filter((tool) => tool.name !== "ragSearch"),
      createBackendBookSearchTool({
        bookEditionId: options.bookEditionId,
        spoilerFree: options.spoilerFree,
        fallbackSearch: fallbackSearch.execute,
        fallbackPath: localRagSearch ? "index" : "proxy-fallback",
        onPath: options.onPath,
        request: options.request,
      }),
    ];
  };
}

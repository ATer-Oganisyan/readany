import { getAvailableTools } from "@readany/core/ai/tools";
import type { ToolDefinition } from "@readany/core/ai/tools";
import type { Skill } from "@readany/core/types";
import {
  type BackendBookSearchMode,
  type BackendBookSpoilerMode,
  searchBackendBookGraph,
} from "./backend-book-api";

const BACKEND_BOOK_CHAT_COMPATIBLE_TOOLS = new Set([
  "getCurrentChapter",
  "getSurroundingContext",
  "getReadingProgress",
  "getRecentHighlights",
  "getAnnotations",
  "getSelection",
]);

function toolMode(value: unknown): BackendBookSearchMode {
  if (value === "vector" || value === "semantic") return "semantic";
  if (value === "bm25" || value === "lexical") return "lexical";
  return "hybrid";
}

function toolLimit(value: unknown): number {
  const parsed = typeof value === "number" ? Math.trunc(value) : Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(10, Math.max(1, parsed)) : 8;
}

export function createBackendBookRagSearchTool({
  bookId,
  bookEditionId,
  spoilerMode,
}: {
  bookId: string;
  bookEditionId: string;
  spoilerMode: BackendBookSpoilerMode;
}): ToolDefinition {
  return {
    name: "ragSearch",
    description:
      "Search the authenticated backend index for this book. Returns matching text plus spoiler-bounded characters, events, relationships, story arcs, and grounded evidence. Prefer this tool for plot, character, relationship, chronology, and whole-book questions.",
    parameters: {
      query: {
        type: "string",
        description: "The question or concept to retrieve from the current book",
        required: true,
      },
      mode: {
        type: "string",
        description: 'Search mode: "hybrid" (recommended), "vector", or "bm25"',
      },
      topK: { type: "number", description: "Number of results to return (default: 8)" },
    },
    execute: async (args) => {
      const query = String(args.query || "").trim();
      const result = await searchBackendBookGraph(bookEditionId, {
        query,
        mode: toolMode(args.mode),
        spoilerMode,
        limit: toolLimit(args.topK),
        maxHops: 2,
      });
      return {
        source: "narra-backend-graph-rag",
        bookId,
        bookEditionId: result.bookEditionId,
        query: result.query,
        requestedMode: result.requestedMode,
        effectiveMode: result.effectiveMode,
        spoilerMode: result.spoilerMode,
        maxTextOffset: result.maxTextOffset,
        indexState: result.state,
        contentResults: result.contentResults,
        narrativeNodes: result.nodes,
        relationships: result.edges,
        storyArcs: result.storyArcs,
        evidence: result.evidence,
        instruction:
          "The backend retrieval is complete. Do not call more retrieval or citation tools in this turn; answer the user now from these spoiler-bounded results. Cite evidence in plain text, distinguish explicit facts from inference, and use text offsets only as positions in the backend-normalized book.",
      };
    },
  };
}

export function createBackendBookChatToolProvider({
  bookEditionId,
  localBookIsVectorized,
}: {
  bookEditionId: string;
  localBookIsVectorized: boolean;
}) {
  return ({
    bookId,
    enabledSkills,
    spoilerFree,
  }: {
    bookId: string | null;
    isVectorized: boolean;
    enabledSkills: Skill[];
    spoilerFree: boolean;
  }): ToolDefinition[] => {
    const tools = getAvailableTools({
      bookId,
      isVectorized: localBookIsVectorized,
      enabledSkills,
    });
    if (!bookId) return tools;
    const backendSearch = createBackendBookRagSearchTool({
      bookId,
      bookEditionId,
      spoilerMode: spoilerFree ? "reader" : "full",
    });
    const compatibleTools = tools.filter((tool) =>
      BACKEND_BOOK_CHAT_COMPATIBLE_TOOLS.has(tool.name),
    );
    return [...compatibleTools, backendSearch];
  };
}

import type { AIEndpoint, VectorModelConfig } from "@readany/core/types";

// Provider credentials must never be compiled into a mobile bundle. Users may
// still add their own endpoint in Settings; Narra-owned features use Gateway.
const apiKey = "";
const model = process.env.EXPO_PUBLIC_OPENROUTER_MODEL?.trim() || "google/gemini-3.5-flash-lite";
const embeddingModel =
  process.env.EXPO_PUBLIC_OPENROUTER_EMBEDDING_MODEL?.trim() || "openai/text-embedding-3-small";

export const BUNDLED_OPENROUTER_EMBEDDING_ID = "bundled-openrouter-embedding";

export const hasBundledOpenRouterKey = apiKey.length > 0;
export const bundledOpenRouterModel = model;
export const bundledOpenRouterEmbeddingModel: VectorModelConfig = {
  id: BUNDLED_OPENROUTER_EMBEDDING_ID,
  name: "Narra Semantic Search",
  url: "https://openrouter.ai/api/v1/embeddings",
  modelId: embeddingModel,
  apiKey: "",
  description: "Встроенный смысловой поиск по книгам",
  dimension: 1536,
};

export const bundledOpenRouterEndpoint: AIEndpoint = {
  id: "bundled-openrouter",
  name: "OpenRouter",
  provider: "openrouter",
  apiKey: "",
  baseUrl: "https://openrouter.ai/api/v1",
  useExactRequestUrl: false,
  models: [model],
  modelsFetched: true,
};

export function getBundledApiKey(endpoint: Pick<AIEndpoint, "provider">): string {
  return endpoint.provider === "openrouter" ? apiKey : "";
}

export function hydrateBundledEmbeddingModel(modelConfig: VectorModelConfig): VectorModelConfig {
  if (modelConfig.id !== BUNDLED_OPENROUTER_EMBEDDING_ID) return modelConfig;
  return { ...modelConfig, apiKey };
}

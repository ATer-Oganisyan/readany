import type { AIEndpoint } from "@readany/core/types";

const apiKey = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY?.trim() || "";
const model = process.env.EXPO_PUBLIC_OPENROUTER_MODEL?.trim() || "google/gemini-3.5-flash-lite";

export const hasBundledOpenRouterKey = apiKey.length > 0;
export const bundledOpenRouterModel = model;

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

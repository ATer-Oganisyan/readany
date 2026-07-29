import { useSettingsStore } from "@/stores/settings-store";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createChatModel } from "@readany/core/ai/llm-provider";
import type { AIConfig, AIEndpoint } from "@readany/core/types";
import { providerRequiresApiKey } from "@readany/core/utils";

const MAX_EXCERPT_CHARS = 6000;
const MAX_TITLE_CHARS = 180;

export interface GeneratedBookIdentity {
  title: string;
  author?: string;
}

export function isTechnicalBookTitle(title: string): boolean {
  const value = title.trim();
  if (!value) return true;
  if (/^\d{5,}$/.test(value)) return true;
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) return true;
  if (/^[0-9a-f]{16,}$/i.test(value)) return true;
  return /^(?:book|книга|untitled|без названия)(?:[-_\s]*\d+)?$/i.test(value);
}

export function isSuspiciousBookTitle(title: string, fileName: string): boolean {
  const value = title.trim();
  const fileStem = fileName.replace(/\.[^.]+$/i, "").trim();
  if (isTechnicalBookTitle(value)) return true;
  if (value.toLocaleLowerCase() === fileStem.toLocaleLowerCase()) return true;
  return false;
}

async function resolveConnectedGeminiConfig(): Promise<AIConfig | null> {
  const state = useSettingsStore.getState();
  await state.loadApiKeys();
  const refreshed = useSettingsStore.getState();
  const config = refreshed.aiConfig;

  const candidates: Array<{ endpoint: AIEndpoint; model: string }> = [];
  for (const endpoint of config.endpoints) {
    for (const model of endpoint.models) {
      if (model.toLowerCase().includes("gemini")) candidates.push({ endpoint, model });
    }
  }
  candidates.sort((a, b) => {
    const aActive = a.endpoint.id === config.activeEndpointId && a.model === config.activeModel;
    const bActive = b.endpoint.id === config.activeEndpointId && b.model === config.activeModel;
    return Number(bActive) - Number(aActive);
  });

  for (const candidate of candidates) {
    const hydrated = await refreshed.getEndpointById(candidate.endpoint.id);
    if (!hydrated) continue;
    if (providerRequiresApiKey(hydrated.provider) && !hydrated.apiKey) continue;
    return {
      ...config,
      activeEndpointId: hydrated.id,
      activeModel: candidate.model,
      endpoints: config.endpoints.map((endpoint) =>
        endpoint.id === hydrated.id ? hydrated : endpoint,
      ),
    };
  }

  return null;
}

function responseText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("\n");
}

function parseIdentity(raw: string): GeneratedBookIdentity | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const value = JSON.parse(json) as { title?: unknown; author?: unknown };
    const title = typeof value.title === "string" ? value.title.replace(/\s+/g, " ").trim() : "";
    const author = typeof value.author === "string" ? value.author.replace(/\s+/g, " ").trim() : "";
    if (!title || title.length > MAX_TITLE_CHARS) return null;
    return { title, author: author || undefined };
  } catch {
    return null;
  }
}

export async function generateBookIdentityWithGemini(input: {
  fileName: string;
  detectedTitle?: string;
  detectedAuthor?: string;
  excerpt?: string;
}): Promise<GeneratedBookIdentity | null> {
  const config = await resolveConnectedGeminiConfig();
  if (!config) return null;

  const model = await createChatModel(config, {
    temperature: 0,
    maxTokens: 220,
    streaming: false,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Awaited<ReturnType<typeof model.invoke>>;
  try {
    response = await model.invoke(
      [
        new SystemMessage(
          [
            "Определи настоящее название и автора книги по её метаданным и небольшому фрагменту.",
            "Не используй имя файла как название, если оно похоже на номер, UUID или технический идентификатор.",
            "Не переводи и не сокращай название. Ничего не выдумывай.",
            'Ответь только JSON без Markdown: {"title":"...","author":"..."}.',
          ].join("\n"),
        ),
        new HumanMessage(
          [
            `Имя файла: ${input.fileName}`,
            `Название из метаданных: ${input.detectedTitle || "не найдено"}`,
            `Автор из метаданных: ${input.detectedAuthor || "не найден"}`,
            `Фрагмент книги:\n${(input.excerpt || "").slice(0, MAX_EXCERPT_CHARS)}`,
          ].join("\n\n"),
        ),
      ],
      { signal: controller.signal },
    );
  } finally {
    clearTimeout(timeout);
  }

  const identity = parseIdentity(responseText(response.content));
  if (!identity || isSuspiciousBookTitle(identity.title, input.fileName)) return null;
  return identity;
}

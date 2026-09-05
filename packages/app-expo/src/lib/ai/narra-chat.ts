/**
 * Чат персонажа через Narra Gateway (`/v2/ai/chat/complete`).
 *
 * Раньше этот путь шёл прямо в OpenRouter (openrouter-chat.ts), чтобы не
 * зависеть от installation-авторизации шлюза. Теперь бэкенд снова единая точка:
 * модель и ключ живут на сервере, приложение отдаёт только сообщения.
 *
 * Отличие от прежнего контракта: `max_tokens` шлюз не принимает — длину ответа
 * задаёт сервер. Полный ответ, включая его тело, ограничен общим дедлайном.
 */

import { consumeNarraGatewayResponse } from "@/lib/ai/narra-gateway-fetch";
import { type GatewayConsumerScope, readGatewayResponseText } from "./narra-gateway-consumer";

import { NarraServiceError, normalizeNarraError } from "../narra/errors";

export interface NarraChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface NarraChatRequest {
  messages: NarraChatMessageInput[];
  temperature?: number;
  /** Назначение запроса для серверных лимитов и телеметрии. */
  purpose?: "character_chat" | "structured_task" | "summary" | "scenario" | "memory";
  origin?: "user" | "background";
  analyticsTier?: "none" | "essential";
  signal?: AbortSignal;
}

type ChatCompletionResponse = { text?: string; content?: string; error?: string };

async function readCompletion(response: Response, scope: GatewayConsumerScope): Promise<string> {
  const body = await readGatewayResponseText(response, scope);
  let payload: ChatCompletionResponse | null = null;
  try {
    payload = JSON.parse(body) as ChatCompletionResponse;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.error || `Chat request failed (${response.status})`);
  }
  const content = (payload?.text || payload?.content || (payload ? "" : body)).trim();
  if (!content) throw new NarraServiceError("SERVICE", "Сервис вернул пустой ответ.");
  return content;
}

export async function completeNarraChat(request: NarraChatRequest): Promise<string> {
  try {
    const origin = request.origin ?? "user";
    return await consumeNarraGatewayResponse(
      "/v2/ai/chat/complete",
      {
        method: "POST",
        signal: request.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: request.messages,
          temperature: request.temperature ?? 0.8,
          purpose: request.purpose ?? "character_chat",
          origin,
          analytics_tier: request.analyticsTier ?? (origin === "background" ? "none" : "essential"),
        }),
      },
      readCompletion,
    );
  } catch (error) {
    if (request.signal?.aborted) throw error;
    throw normalizeNarraError(error);
  }
}

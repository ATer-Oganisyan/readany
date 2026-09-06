import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatOpenAI } from "@langchain/openai";

// Actual installed LangChain/OpenAI SDK; only the transport is replaced.
// No app hook, database, native transport or provider inference is exercised.
beforeEach(() => {
  vi.stubEnv("LANGSMITH_TRACING", "false");
  vi.stubEnv("LANGCHAIN_TRACING_V2", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected real network request"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const tokenFrame = `data: ${JSON.stringify({
  id: "own-sdk-stream", object: "chat.completion.chunk", created: 1, model: "own-fixture",
  choices: [{ index: 0, delta: { role: "assistant", content: "Начало ответа" }, finish_reason: null }],
})}\n\n`;
const errorFrame = 'event: error\ndata: {"error":{"code":"PARSE"}}\n\n';
const stopFrame = `data: ${JSON.stringify({
  id: "own-sdk-stream", object: "chat.completion.chunk", created: 1, model: "own-fixture",
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
})}\n\ndata: [DONE]\n\n`;

function modelWithResponse(frames: string[], splitBytes: boolean) {
  const transport = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        const bytes = new TextEncoder().encode(frame);
        if (splitBytes) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        else controller.enqueue(bytes);
      }
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } }));
  return { transport, model: new ChatOpenAI({
    apiKey: "dummy-model-free-key", model: "own-fixture", streaming: true, maxRetries: 0,
    configuration: { baseURL: "https://fixture.invalid/v1", fetch: transport },
  }) };
}

it.each([false, true])("actual SDK rejects gateway PARSE event after a partial token (byte split: %s)", async (splitBytes) => {
  const { model, transport } = modelWithResponse([tokenFrame, errorFrame], splitBytes);
  const tokens: string[] = [];
  const onEnd = vi.fn();
  const onError = vi.fn();
  let completed = false;
  const consume = async () => {
    const stream = await model.stream("Own fixture question", {
      callbacks: [{ handleLLMEnd: onEnd, handleLLMError: onError }],
    });
    for await (const chunk of stream) if (typeof chunk.content === "string") tokens.push(chunk.content);
    completed = true;
  };
  await expect(consume()).rejects.toMatchObject({ code: "PARSE" });
  expect(tokens.join("")).toBe("Начало ответа");
  expect(completed).toBe(false);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onEnd).not.toHaveBeenCalled();
  expect(transport).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it("actual SDK still completes a valid token/stop/DONE stream", async () => {
  const { model, transport } = modelWithResponse([tokenFrame, stopFrame], true);
  const stream = await model.stream("Own fixture question");
  let text = "";
  for await (const chunk of stream) if (typeof chunk.content === "string") text += chunk.content;
  expect(text).toBe("Начало ответа");
  expect(transport).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

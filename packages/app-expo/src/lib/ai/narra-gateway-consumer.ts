import { NarraServiceError } from "../narra/errors";

export interface GatewayConsumerScope {
  readonly signal: AbortSignal;
  throwIfAborted(): void;
  /** Stops this waiter without cancelling a shared operation such as token refresh. */
  wait<T>(operation: PromiseLike<T>): Promise<T>;
}

function callerAbortReason(signal?: AbortSignal | null): unknown {
  if (signal?.reason !== undefined) return signal.reason;
  return Object.assign(new Error("Gateway request was cancelled"), { name: "AbortError" });
}

/** A deadline for a consumed response, including auth, headers, and its complete body. */
export async function withGatewayConsumer<T>(
  consume: (scope: GatewayConsumerScope) => Promise<T>,
  options: { signal?: AbortSignal | null; timeoutMs: number },
): Promise<T> {
  const controller = new AbortController();
  let failure: unknown;
  const cancel = (reason: unknown) => {
    if (controller.signal.aborted) return;
    failure = reason;
    controller.abort(reason);
  };
  const abortFromCaller = () => cancel(callerAbortReason(options.signal));
  const scope: GatewayConsumerScope = {
    signal: controller.signal,
    throwIfAborted() {
      if (controller.signal.aborted) throw failure;
    },
    wait<TValue>(operation: PromiseLike<TValue>): Promise<TValue> {
      return new Promise<TValue>((resolve, reject) => {
        const onAbort = () => {
          controller.signal.removeEventListener("abort", onAbort);
          reject(failure);
        };
        if (controller.signal.aborted) {
          // A shared operation can reject after its consumer has left. Always
          // observe it, even though this waiter no longer needs the result.
          Promise.resolve(operation).catch(() => {});
          reject(failure);
          return;
        }
        controller.signal.addEventListener("abort", onAbort, { once: true });
        Promise.resolve(operation).then(
          (value) => {
            controller.signal.removeEventListener("abort", onAbort);
            resolve(value);
          },
          (error) => {
            controller.signal.removeEventListener("abort", onAbort);
            reject(error);
          },
        );
      });
    },
  };
  const timeout = setTimeout(
    () =>
      cancel(
        new NarraServiceError("TIMEOUT", "Сервис отвечает дольше обычного. Попробуйте ещё раз."),
      ),
    options.timeoutMs,
  );
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    scope.throwIfAborted();
    return await scope.wait(consume(scope));
  } catch (error) {
    // A body/parser failure must also stop its transport while the request
    // still owns the native abort subscription.
    cancel(error);
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * Read through the abortable body stream. Expo iOS 57's native text() waits only
 * for bodyCompleted, so a body error/cancellation can otherwise leave it pending.
 */
export async function readGatewayResponseText(
  response: Response,
  scope: GatewayConsumerScope,
): Promise<string> {
  scope.throwIfAborted();
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let completed = false;
  try {
    while (true) {
      const part = await scope.wait(reader.read());
      if (part.done) {
        completed = true;
        return text + decoder.decode();
      }
      text += decoder.decode(part.value, { stream: true });
    }
  } finally {
    if (!completed) {
      // Stream cancellation itself need not settle promptly. It must not hold
      // a dismissed screen's caller open; late rejection is still observed.
      void reader.cancel(scope.signal.reason).catch(() => {});
    }
    reader.releaseLock();
  }
}

/** Binary counterpart for audio; bounded while streaming, including a slow/incomplete body. */
export async function readGatewayResponseBytes(
  response: Response,
  scope: GatewayConsumerScope,
  maxBytes: number,
): Promise<Uint8Array> {
  scope.throwIfAborted();
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let completed = false;
  try {
    while (true) {
      const part = await scope.wait(reader.read());
      if (part.done) {
        completed = true;
        break;
      }
      length += part.value.byteLength;
      if (length > maxBytes)
        throw new NarraServiceError("SERVICE", "Ответ озвучки превышает допустимый размер.");
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    if (!completed) void reader.cancel(scope.signal.reason).catch(() => {});
    reader.releaseLock();
  }
}

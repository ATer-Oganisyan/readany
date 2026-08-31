import { BackendSceneError } from "./backend-scene";

interface SharedOperation<T> {
  controller: AbortController;
  consumers: number;
  settled: boolean;
  promise: Promise<T>;
}

const operations = new Map<string, SharedOperation<unknown>>();

function abortError(): BackendSceneError {
  return new BackendSceneError("SCENE_ABORTED");
}

/** Shares backend polling/download work while keeping cancellation consumer-owned. */
export function consumeBackendSceneOperation<T>(
  id: string,
  start: (signal: AbortSignal) => Promise<T>,
  consumerSignal: AbortSignal,
): Promise<T> {
  let operation = operations.get(id) as SharedOperation<T> | undefined;
  if (!operation) {
    const controller = new AbortController();
    operation = {
      controller,
      consumers: 0,
      settled: false,
      promise: Promise.resolve(undefined as T),
    };
    const ownedOperation = operation;
    operation.promise = start(controller.signal).finally(() => {
      ownedOperation.settled = true;
      if (operations.get(id) === ownedOperation) operations.delete(id);
    });
    operations.set(id, operation as SharedOperation<unknown>);
  }
  operation.consumers += 1;

  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return;
      finished = true;
      consumerSignal.removeEventListener("abort", onAbort);
      operation.consumers -= 1;
      if (operation.consumers === 0 && !operation.settled) operation.controller.abort();
    };
    const onAbort = () => {
      release();
      reject(abortError());
    };
    if (consumerSignal.aborted) return onAbort();
    consumerSignal.addEventListener("abort", onAbort, { once: true });
    operation.promise.then(
      (value) => {
        if (finished) return;
        release();
        resolve(value);
      },
      (error) => {
        if (finished) return;
        release();
        reject(error);
      },
    );
  });
}

export function clearBackendSceneOperationsForTests(): void {
  for (const operation of operations.values()) operation.controller.abort();
  operations.clear();
}

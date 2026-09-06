export interface ReaderPosition {
  progress: number;
  currentCfi: string;
}

/** Saves infrequent page changes and flushes the latest position when reading is interrupted. */
export function createReaderProgressPersistence(
  save: (position: ReaderPosition) => Promise<void>,
  onError: (error: unknown) => void,
  intervalMs = 5000,
) {
  let pending: ReaderPosition | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastWriteAt = Number.NEGATIVE_INFINITY;
  const writes = new Set<Promise<void>>();

  function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    if (pending) {
      const position = pending;
      pending = undefined;
      lastWriteAt = Date.now();
      // Call save synchronously so the library reflects this position before navigation.
      try {
        const write = Promise.resolve(save(position)).catch(onError);
        writes.add(write);
        void write.finally(() => writes.delete(write));
      } catch (error) {
        onError(error);
      }
    }
    return Promise.all([...writes]).then(() => {});
  }

  return {
    update(progress: number, currentCfi: string) {
      if (!currentCfi || !Number.isFinite(progress)) return;
      pending = { progress: Math.max(0, Math.min(1, progress)), currentCfi };
      const remaining = intervalMs - (Date.now() - lastWriteAt);
      if (remaining <= 0) void flush();
      else if (!timer) timer = setTimeout(() => void flush(), remaining);
    },
    flush,
  };
}

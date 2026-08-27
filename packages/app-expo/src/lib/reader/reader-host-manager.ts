export interface ReaderHost {
  serverUrl: string;
  fontFaceCSS: string;
}

interface HostIO {
  start: (restart: boolean, fallback: boolean) => Promise<string>;
  probe: (url: string) => Promise<boolean>;
  fonts: (url: string) => Promise<string>;
  recovered?: () => void;
}

/** Serialize opens/retries. A resolved promise is not a lifetime health check. */
export function createReaderHostManager(io: HostIO) {
  let queue: Promise<unknown> = Promise.resolve();
  let current: ReaderHost | null = null;

  const prepare = (restart = false): Promise<ReaderHost> => {
    const operation = queue
      .catch(() => {})
      .then(async () => {
        if (!restart && current && (await io.probe(current.serverUrl))) return current;
        const recovering = restart || current !== null;
        current = null;
        let url = await io.start(recovering, false);
        if (!(await io.probe(url))) {
          // Native startup can succeed before the server becomes unresponsive.
          // Try the independent TCP implementation once, never an infinite loop.
          url = await io.start(true, true);
          if (!(await io.probe(url))) throw new Error("Reader file server is unavailable");
        }
        const host = { serverUrl: url, fontFaceCSS: await io.fonts(url) };
        current = host;
        if (recovering) io.recovered?.();
        return host;
      });
    queue = operation;
    return operation;
  };

  return { prepare };
}

export async function withTimeout<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Reader operation timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

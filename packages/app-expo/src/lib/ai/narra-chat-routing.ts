export type NarraChatMode = "proxy-first" | "index-first";
export type NarraChatPath = "index" | "proxy-primary" | "proxy-fallback";

export const DEFAULT_NARRA_CHAT_MODE: NarraChatMode = "index-first";

export interface NarraChatRoutePlan {
  mode: NarraChatMode;
  initialPath: NarraChatPath;
  useServerIndex: boolean;
  useLocalIndex: boolean;
}

/**
 * Selects retrieval only. The language model itself always uses Narra Gateway;
 * no mode permits a direct mobile request to OpenRouter.
 */
export function resolveNarraChatRoute(options: {
  mode: NarraChatMode;
  bookId?: string | null;
  bookEditionId?: string | null;
  isLocallyIndexed?: boolean;
}): NarraChatRoutePlan {
  const hasBook = Boolean(options.bookId);
  const hasServerIndexIdentity = hasBook && Boolean(options.bookEditionId);
  const useServerIndex = options.mode === "index-first" && hasServerIndexIdentity;
  const useLocalIndex =
    options.mode === "index-first" && hasBook && options.isLocallyIndexed === true;

  if (useServerIndex || useLocalIndex) {
    return {
      mode: options.mode,
      initialPath: "index",
      useServerIndex,
      useLocalIndex,
    };
  }
  if (options.mode === "index-first" && hasBook) {
    return {
      mode: options.mode,
      initialPath: "proxy-fallback",
      useServerIndex: false,
      useLocalIndex: false,
    };
  }
  return {
    mode: options.mode,
    initialPath: "proxy-primary",
    useServerIndex: false,
    useLocalIndex: false,
  };
}

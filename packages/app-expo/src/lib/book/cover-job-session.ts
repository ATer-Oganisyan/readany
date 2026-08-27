import { AppState } from "react-native";

/** Only polling is paused; the server job is independent of this JS session. */
export async function inCoverForeground<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  while (true) {
    if (AppState.currentState && AppState.currentState !== "active") {
      await new Promise<void>((resolve) => {
        const subscription = AppState.addEventListener("change", (state) => {
          if (state === "active") {
            subscription.remove();
            resolve();
          }
        });
      });
    }
    const controller = new AbortController();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") controller.abort();
    });
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      subscription.remove();
    }
  }
}

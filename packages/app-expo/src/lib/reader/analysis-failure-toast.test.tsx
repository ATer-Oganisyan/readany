import { useAnalysisFailureToast } from "@/hooks/use-analysis-failure-toast";
import { retryBackendBookAnalysis, useBackendBookStatus } from "@/lib/narra/backend-book-sync";
import { toast } from "@/lib/notifications";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/notifications", () => ({
  toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/lib/narra/backend-book-sync", async () => {
  const { create } = await import("zustand");
  return {
    useBackendBookStatus: create(() => ({ books: {} as Record<string, unknown> })),
    retryBackendBookAnalysis: vi.fn(() => Promise.resolve()),
  };
});

function publish(availability: string | undefined, updatedAt?: string) {
  act(() =>
    useBackendBookStatus.setState({
      books: { b1: { manifest: { availability, analysis: { updatedAt } } } } as never,
    }),
  );
}

function Harness({ active = true }: { active?: boolean }) {
  useAnalysisFailureToast("b1", active);
  return null;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  useBackendBookStatus.setState({ books: {} });
});

it("shows one toast per failure and per screen opening, retry reports success", async () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<Harness />);
  });
  publish("processing");
  expect(toast.error).not.toHaveBeenCalled();
  publish("failed", "t1");
  publish("failed", "t1");
  expect(toast.error).toHaveBeenCalledTimes(1);
  const options = vi.mocked(toast.error).mock.calls[0][1] as {
    action: { label: string; onClick: () => void };
  };
  expect(toast.error).toHaveBeenCalledWith("Не удалось разметить книгу", expect.anything());
  expect(options).toEqual({ action: expect.anything() });
  expect(options.action.label).toBe("Попробовать ещё раз");

  // A newer failed run is a new toast; recovery resets the guard.
  publish("failed", "t2");
  expect(toast.error).toHaveBeenCalledTimes(2);
  publish("ready");
  publish("cancelled", "t3");
  expect(toast.error).toHaveBeenCalledTimes(3);

  // Inactive screen stays quiet until it becomes active.
  act(() => tree.update(<Harness active={false} />));
  publish("failed", "t4");
  expect(toast.error).toHaveBeenCalledTimes(3);
  act(() => tree.update(<Harness />));
  expect(toast.error).toHaveBeenCalledTimes(4);

  // Reopening the screen shows the same failure again.
  act(() => tree.unmount());
  act(() => {
    tree = create(<Harness />);
  });
  expect(toast.error).toHaveBeenCalledTimes(5);

  await act(async () => {
    options.action.onClick();
    await Promise.resolve();
  });
  expect(retryBackendBookAnalysis).toHaveBeenCalledExactlyOnceWith("b1");
  expect(toast.dismiss).toHaveBeenCalledOnce();
  expect(toast.success).toHaveBeenCalledExactlyOnceWith("Разметка запущена заново");
  act(() => tree.unmount());
});

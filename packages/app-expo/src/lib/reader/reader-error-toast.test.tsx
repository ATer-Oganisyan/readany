import { useReaderErrorToast } from "@/hooks/use-reader-error-toast";
import { toast } from "@/lib/notifications";
import { CommonActions, StackRouter } from "@react-navigation/routers";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/notifications", () => ({ toast: { error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

it("shows one focused error per opening and removes a root reader from history", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const router = StackRouter({ initialRouteName: "Reader" });
  const options = { routeNames: ["Reader", "Tabs"], routeParamList: {}, routeGetIdList: {} };
  let state = router.getInitialState(options);
  const navigation = {
    canGoBack: vi.fn(() => state.index > 0),
    goBack: vi.fn(),
    reset: vi.fn((payload) => {
      const resetState = router.getStateForAction(state, CommonActions.reset(payload), options)!;
      state = router.getRehydratedState(resetState, options);
    }),
  };
  function Harness({
    error = null,
    focused = true,
    opening = "book:0",
  }: { error?: string | null; focused?: boolean; opening?: string }) {
    useReaderErrorToast(error, focused, navigation, opening);
    return null;
  }
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(<Harness />);
  });
  try {
    // Recovery stays on the reader while no terminal error has been published.
    expect(toast.error).not.toHaveBeenCalled();
    act(() => tree.update(<Harness error="missing file" focused={false} />));
    expect(toast.error).not.toHaveBeenCalled();
    act(() => tree.update(<Harness error="missing file" />));
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Не удалось открыть книгу", {
      description: "Попробуйте ещё раз",
    });
    expect(state.routes.map((route) => route.name)).toEqual(["Tabs"]);
    expect(router.getStateForAction(state, CommonActions.goBack(), options)).toBeNull();
    act(() => tree.update(<Harness error="another render" />));
    expect(toast.error).toHaveBeenCalledTimes(1);
    navigation.canGoBack.mockReturnValue(true);
    act(() => tree.update(<Harness error="missing file" opening="other-book:0" />));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(2);
    act(() => tree.update(<Harness error="missing file" opening="other-book:1" />));
    expect(toast.error).toHaveBeenCalledTimes(3);
  } finally {
    act(() => tree.unmount());
  }
});

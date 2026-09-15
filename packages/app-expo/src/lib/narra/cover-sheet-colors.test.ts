import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";

const averageTopImageColor = vi.hoisted(() => vi.fn(async () => "#40a0a0"));
vi.mock("../../../modules/native-controls", () => ({ default: { averageTopImageColor } }));
import { useCoverSheetColors } from "../../hooks/use-cover-sheet-colors";

it("reuses the cover palette on the first render after reopening", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const renders: Array<ReturnType<typeof useCoverSheetColors>> = [];
  function Probe({ artwork }: { artwork: string }) {
    renders.push(useCoverSheetColors(artwork));
    return null;
  }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe, { artwork: "cover-a" })); });
  const palette = renders.at(-1);
  expect(palette?.color).toBe("#2a6868");
  act(() => tree.unmount());
  renders.length = 0;
  await act(async () => { tree = create(createElement(Probe, { artwork: "cover-a" })); });
  expect(renders[0]).toEqual(palette);
  expect(averageTopImageColor).toHaveBeenCalledTimes(1);
  renders.length = 0;
  await act(async () => { tree.update(createElement(Probe, { artwork: "cover-b" })); });
  expect(renders[0]).toBeUndefined();
  expect(renders.at(-1)?.uri).toBe("cover-b");
  act(() => tree.unmount());
});

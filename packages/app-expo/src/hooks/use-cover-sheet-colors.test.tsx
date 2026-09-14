import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { useCoverSheetColors } from "./use-cover-sheet-colors";

const sample = vi.hoisted(() => vi.fn().mockResolvedValue("#ff0000"));
vi.mock("../../modules/native-controls", () => ({ default: { averageTopImageColor: sample } }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("uses the cover's top quarter and the shared sheet palette on Android", async () => {
  let palette: ReturnType<typeof useCoverSheetColors>;
  function Probe() {
    palette = useCoverSheetColors("file:///cover.png");
    return null;
  }
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<Probe />);
  });
  expect(sample).toHaveBeenCalledWith("file:///cover.png", 0.25);
  expect(palette).toEqual({ uri: "file:///cover.png", color: "#a60000", accent: "#db9999" });
  await act(async () => {
    renderer.unmount();
  });
});

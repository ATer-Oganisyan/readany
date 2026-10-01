import { createElement, createRef } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
vi.mock("react-native", () => ({
  View: "View",
  Platform: { OS: "ios" },
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("react-native-pager-view", () => ({ default: "Pager" }));
vi.mock("@/components/profile/NativeThemePicker", () => ({ NativeThemePicker: "Picker" }));
vi.mock("@/components/ui/swipe-press-guard", () => ({ useSwipePressGuard: () => undefined }));
vi.mock("@/lib/haptics", () => ({ hapticSelection: vi.fn() }));
import { hapticSelection } from "@/lib/haptics";
import { NativeSegmentedPager, type NativeSegmentedPagerHandle } from "./native-segmented-pager";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("uses light feedback once per filter tap, including the selected filter, never for programmatic selection", () => {
  const light = vi.fn();
  const ref = createRef<NativeSegmentedPagerHandle>();
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(
      <NativeSegmentedPager
        ref={ref}
        values={["All", "Book"]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onSegmentPress={light}
        colorScheme="light"
        accessibilityLabel="Filter"
      >
        {[createElement("Page", { key: "all" }), createElement("Page", { key: "book" })]}
      </NativeSegmentedPager>,
    );
  });
  if (!tree) throw new Error("Pager did not mount");
  const picker = tree.root.findByType("Picker" as never);
  act(() => {
    picker.props.onSelect(0);
    picker.props.onSelect(1);
  });
  expect(light).toHaveBeenCalledTimes(2);
  act(() =>
    tree?.root.findByType("Pager" as never).props.onPageSelected({ nativeEvent: { position: 1 } }),
  );
  act(() => ref.current?.selectPage(0, false));
  expect(light).toHaveBeenCalledTimes(2);
  expect(hapticSelection).not.toHaveBeenCalled();
  act(() => tree?.unmount());
});

import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { createRef } from "react";
const runtime = vi.hoisted(() => ({
  setPage: vi.fn(),
  setPageWithoutAnimation: vi.fn(),
  haptic: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  StyleSheet: { create: (value: unknown) => value },
  View: "View",
}));
vi.mock("@/components/profile/NativeThemePicker", () => ({ NativeThemePicker: "Picker" }));
vi.mock("@/components/ui/swipe-press-guard", () => ({ useSwipePressGuard: () => null }));
vi.mock("@/lib/haptics", () => ({ hapticSelection: runtime.haptic }));
vi.mock("react-native-pager-view", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => runtime);
      return React.createElement("Pager", props);
    }),
  };
});
import {
  NativeSegmentedPager,
  type NativeSegmentedPagerHandle,
} from "@/components/ui/native-segmented-pager";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  vi.clearAllMocks();
});
async function setup() {
  const selected = vi.fn();
  const ref = createRef<NativeSegmentedPagerHandle>();
  const render = (index: number) => (
    <NativeSegmentedPager
      ref={ref}
      values={["Popular", "My books"]}
      selectedIndex={index}
      onSelect={selected}
      colorScheme="light"
      accessibilityLabel="Sections"
    >
      <>{"Popular"}</>
      <>{"My books"}</>
    </NativeSegmentedPager>
  );
  await act(async () => {
    tree = create(render(0));
  });
  const event = async (position: number) => {
    await act(async () =>
      tree.root
        .find((node) => String(node.type) === "Pager")
        .props.onPageSelected({ nativeEvent: { position } }),
    );
  };
  const restore = async () => {
    await act(async () => tree.update(render(1)));
  };
  const scroll = async (pageScrollState: string) => {
    await act(async () =>
      tree.root
        .find((node) => String(node.type) === "Pager")
        .props.onPageScrollStateChanged({ nativeEvent: { pageScrollState } }),
    );
  };
  return { selected, ref, event, restore, scroll };
}
it("ignores delayed initial page zero while restored page one awaits native acknowledgement", async () => {
  const { selected, restore, event } = await setup();
  await restore();
  await event(0);
  expect(selected).not.toHaveBeenCalled();
  await event(1);
  expect(selected).not.toHaveBeenCalled();
});
it("allows a real drag to override a pending restored selection", async () => {
  const { selected, restore, event, scroll } = await setup();
  await restore();
  await scroll("dragging");
  await event(0);
  expect(selected).toHaveBeenCalledExactlyOnceWith(0);
});
it("keeps imperative switching and ignores obsolete acknowledgements", async () => {
  const { selected, ref, event, restore } = await setup();
  await event(0);
  await act(async () => ref.current!.selectPage(1));
  expect(runtime.setPage).toHaveBeenCalledWith(1);
  expect(selected).toHaveBeenCalledExactlyOnceWith(1);
  await restore();
  await event(0);
  expect(selected).toHaveBeenCalledTimes(1);
});
it("accepts an accessibility selection without dragging after acknowledgement", async () => {
  const { selected, restore, event } = await setup();
  await restore();
  await event(1);
  await event(0);
  expect(selected).toHaveBeenCalledExactlyOnceWith(0);
});

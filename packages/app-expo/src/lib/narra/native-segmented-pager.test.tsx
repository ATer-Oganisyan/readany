import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRef } from "react";
const runtime = vi.hoisted(() => ({
  setPage: vi.fn(),
  setPageWithoutAnimation: vi.fn(),
  haptic: vi.fn(),
  physicalPage: 0,
  lostCommands: 0,
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
beforeEach(() => {
  runtime.physicalPage = 0;
  runtime.lostCommands = 0;
  const command = (index: number) => {
    if (runtime.lostCommands > 0) runtime.lostCommands -= 1;
    else runtime.physicalPage = index;
  };
  runtime.setPage.mockImplementation(command);
  runtime.setPageWithoutAnimation.mockImplementation(command);
});
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
  expect(runtime.setPageWithoutAnimation).toHaveBeenCalledTimes(2);
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
it("reconciles the physical page when the restored command was lost before native initialization", async () => {
  const { selected, restore, event } = await setup();
  runtime.lostCommands = 1;
  await restore();
  expect(runtime.physicalPage).toBe(0);
  await event(0);
  expect(runtime.physicalPage).toBe(1);
  expect(selected).not.toHaveBeenCalled();
  expect(runtime.setPageWithoutAnimation).toHaveBeenCalledTimes(3);
  await event(1);
  await event(0);
  expect(selected).toHaveBeenCalledExactlyOnceWith(0);
});
it("bounds automatic reconciliation when native keeps reporting the wrong page", async () => {
  const { selected, restore, event } = await setup();
  runtime.lostCommands = 10;
  await restore();
  for (let index = 0; index < 10; index += 1) await event(0);
  expect(runtime.setPageWithoutAnimation).toHaveBeenCalledTimes(3);
  expect(selected).not.toHaveBeenCalled();
});
it("lets an explicit tap on the selected segment recover an unacknowledged page", async () => {
  const { selected, restore, event } = await setup();
  runtime.lostCommands = 2;
  await restore();
  await event(0);
  expect(runtime.physicalPage).toBe(0);
  await act(async () => tree.root.find((node) => String(node.type) === "Picker").props.onSelect(1));
  expect(runtime.physicalPage).toBe(1);
  expect(selected).not.toHaveBeenCalled();
  expect(runtime.haptic).not.toHaveBeenCalled();
});
it("does not recurse when a reconciliation command synchronously reports a wrong page", async () => {
  const { selected, restore, event } = await setup();
  await restore();
  runtime.setPageWithoutAnimation.mockImplementation(() => {
    tree.root
      .find((node) => String(node.type) === "Pager")
      .props.onPageSelected({ nativeEvent: { position: 0 } });
  });
  await event(0);
  expect(runtime.setPageWithoutAnimation).toHaveBeenCalledTimes(3);
  expect(selected).not.toHaveBeenCalled();
});

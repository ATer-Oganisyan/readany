import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({ os: "ios" }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return ports.os;
    },
  },
}));
vi.mock("react-native-screens", async () => {
  // Execute the installed JS adapter too: assertion reaches its native prop,
  // not merely our wrapper's public prop. Native AX traversal remains device QA.
  const react = await import("react");
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("react-native-screens/package.json"));
  const code = transformSync(
    readFileSync(join(root, "src/components/FullWindowOverlay.tsx"), "utf8"),
    { loader: "tsx", format: "cjs" },
  ).code;
  const module = { exports: {} as { default: React.ElementType } };
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react-native")
        return {
          Platform: { OS: "ios" },
          StyleSheet: { absoluteFill: {} },
          useWindowDimensions: () => ({ width: 400, height: 800 }),
          View: "View",
        };
      if (name.includes("FullWindowOverlayNativeComponent"))
        return { __esModule: true, default: "NativeOverlay" };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { FullWindowOverlay: module.exports.default };
});
import { FullWindowOverlay } from "react-native-screens";
import { ToastOverlay } from "@/components/ui/toast-overlay";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  ports.os = "ios";
});
it("installed default leaves the native modal default in effect", async () => {
  await act(async () => {
    tree = create(<FullWindowOverlay>{createElement("Toast")}</FullWindowOverlay>);
  });
  expect(
    tree.root.findByType("NativeOverlay" as React.ElementType).props
      .accessibilityContainerViewIsModal,
  ).toBeUndefined();
});
it("iOS explicitly disables native AX modality and preserves the live Cancel callback", async () => {
  const cancel = vi.fn();
  await act(async () => {
    tree = create(<ToastOverlay>{createElement("Cancel", { onPress: cancel })}</ToastOverlay>);
  });
  expect(
    tree.root.findByType("NativeOverlay" as React.ElementType).props
      .accessibilityContainerViewIsModal,
  ).toBe(false);
  await act(async () => tree.root.findByType("Cancel" as React.ElementType).props.onPress());
  expect(cancel).toHaveBeenCalledOnce();
});
it("Android passes children through without creating a window overlay", async () => {
  ports.os = "android";
  await act(async () => {
    tree = create(<ToastOverlay>{createElement("Toast")}</ToastOverlay>);
  });
  expect(tree.root.findAllByType("NativeOverlay" as React.ElementType)).toHaveLength(0);
  expect(tree.root.findAllByType("Toast" as React.ElementType)).toHaveLength(1);
});

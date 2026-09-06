import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as React from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";

// Execute actual installed package files. Native layout/accessibility
// remains a separate device gate; this adapter checks the emitted bounds.
function fixture(os: string, expanded = false) {
  const dir = dirname(createRequire(import.meta.url).resolve("sonner-native/package.json"));
  const collapse = vi.fn();
  const cache = new Map<string, any>();
  const load = (name: string): any => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return createRequire(import.meta.url)(name);
    if (name === "react-native")
      return { Platform: { OS: os }, View: "View", Pressable: "Pressable" };
    if (name === "react-native-safe-area-context")
      return {
        SafeAreaInsetsContext: React.createContext({ top: 44, bottom: 34 }),
        initialWindowMetrics: null,
      };
    if (name === "./context")
      return {
        useToastContext: () => ({ gap: 8, visibleToasts: 2 }),
        useDynamicToastContext: () => ({ isExpanded: expanded, collapse, toastHeights: {} }),
      };
    if (cache.has(name)) return cache.get(name);
    const filename = name === "./positioner" ? "positioner.tsx" : `${name.slice(2)}.ts`;
    const module = { exports: {} };
    const code = transformSync(readFileSync(join(dir, "src", filename), "utf8"), {
      loader: filename.endsWith("tsx") ? "tsx" : "ts",
      format: "cjs",
      jsx: "automatic",
    }).code;
    runInNewContext(code, { module, exports: module.exports, require: load });
    cache.set(name, module.exports);
    return module.exports;
  };
  return { load, collapse };
}

for (const position of ["top-center", "bottom-center"] as const) {
  it(`Android ${position} retains safe edge and gives absolute toasts a viewport`, () => {
    const f = fixture("android");
    let tree: any;
    try {
      const { Positioner } = f.load("./positioner");
      const clicked = vi.fn();
      const Pressable = "Pressable" as any;
      act(() => {
        tree = create(
          <Positioner position={position}>
            <Pressable onPress={clicked}>Open</Pressable>
          </Positioner>,
        );
      });
      const view = tree.root.findByType("View");
      const style = Object.assign({}, ...view.props.style);
      expect(style.top).toBe(position === "top-center" ? 52 : 0);
      expect(style.bottom).toBe(position === "bottom-center" ? 42 : 0);
      expect(view.props.pointerEvents).toBe("box-none");
      act(() => tree.root.findByType("Pressable").props.onPress());
      expect(clicked).toHaveBeenCalledOnce();
      act(() => tree.update(<Positioner position={position} />));
      expect(tree.root.findAllByType("Pressable")).toHaveLength(0);
      expect(tree.root.findByType("View").props.pointerEvents).toBe("none");
    } finally {
      if (tree) act(() => tree.unmount());
    }
  });
}

it("iOS and center geometry and explicit safe offsets stay unchanged", () => {
  for (const os of ["ios", "android"]) {
    const f = fixture(os);
    const { getContainerStyle, getInsetValues } = f.load("./positioner-utils");
    expect(getContainerStyle("center")).toEqual({
      position: "absolute",
      top: "50%",
      left: 0,
      right: 0,
      alignItems: "center",
      overflow: "visible",
    });
    if (os === "ios")
      for (const position of ["top-center", "bottom-center"])
        expect(getContainerStyle(position)).toEqual({
          position: "absolute",
          width: "100%",
          alignItems: "center",
          overflow: "visible",
        });
    expect(
      getInsetValues({
        position: "top-center",
        offset: 71,
        safeAreaInsets: { top: 44, bottom: 34 },
      }),
    ).toEqual({ top: 71 });
    expect(
      getInsetValues({
        position: "bottom-center",
        offset: 71,
        safeAreaInsets: { top: 44, bottom: 34 },
      }),
    ).toEqual({ bottom: 71 });
  }
});

it("expanded outside press still collapses without consuming the toast action", () => {
  const f = fixture("android", true);
  const { Positioner } = f.load("./positioner");
  let tree: any;
  const Text = "Text" as any;
  try {
    act(() => {
      tree = create(
        <Positioner position="top-center">
          <Text>Own toast</Text>
        </Positioner>,
      );
    });
    act(() => tree.root.findByType("Pressable").props.onPress());
    expect(f.collapse).toHaveBeenCalledOnce();
    expect(tree.root.findByType("View").props.pointerEvents).toBe("box-none");
  } finally {
    if (tree) act(() => tree.unmount());
  }
});

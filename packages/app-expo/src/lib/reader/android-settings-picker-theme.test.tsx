import type { ComponentProps } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ systemTheme: "dark" as "dark" | "light" }));
vi.mock("@deslop/primitives/native", () => ({
  interfaceFontFamily: { regular: "SB Sans Interface" },
  serifCondensedFontFamily: { regular: "SB Serif" },
}));
vi.mock("react-native", () => ({ useColorScheme: () => runtime.systemTheme }));
vi.mock("expo-secure-store", () => ({ getItemAsync: async () => null, setItemAsync: vi.fn() }));
vi.mock("@expo/ui/jetpack-compose", () => ({
  Host: "ComposeHost",
  Row: "ComposeRow",
  Text: "ComposeText",
}));
vi.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  fillMaxWidth: () => ({ type: "fillMaxWidth" }),
  padding: (...values: number[]) => ({ type: "padding", values }),
}));
vi.mock("@expo/ui", async () => {
  const { createElement } = await import("react");
  return {
    Picker: Object.assign(
      (props: Record<string, unknown>) => createElement("NativePicker", props),
      { Item: "NativePickerItem" },
    ),
  };
});

import { NativeSettingsPicker } from "@/components/settings/NativeSettingsPicker.android";
import { ThemeProvider, useTheme } from "@/styles/ThemeContext";
import { makeThemeColors } from "@/styles/theme-colors";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined;
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
});

function ThemedPicker(props: Omit<ComponentProps<typeof NativeSettingsPicker>, "colorScheme">) {
  // Mirrors both real callers: their Host scheme and surrounding card tokens
  // are derived from the same reactive application theme.
  const { isDark } = useTheme();
  return <NativeSettingsPicker {...props} colorScheme={isDark ? "dark" : "light"} />;
}

function mount(mode: "dark" | "light" | "system") {
  const onValueChange = vi.fn();
  const props = {
    label: "Theme",
    selectedValue: "system",
    options: [
      { label: "System", value: "system" },
      { label: "Dark", value: "dark" },
      { label: "Light", value: "light" },
    ],
    onValueChange,
  };
  const element = (
    <ThemeProvider initialMode={mode}>
      <ThemedPicker {...props} />
    </ThemeProvider>
  );
  act(() => {
    tree = create(element);
  });
  return {
    onValueChange,
    update: () =>
      act(() =>
        tree?.update(
          <ThemeProvider initialMode={mode}>
            <ThemedPicker {...props} />
          </ThemeProvider>,
        ),
      ),
  };
}

function host(name: string) {
  return tree?.root.find((node) => String(node.type) === name);
}

describe("Android native settings label uses the application foreground", () => {
  it.each(["dark", "light"] as const)("provides explicit %s foreground to Compose Text", (mode) => {
    mount(mode);
    expect(host("ComposeHost")?.props.colorScheme).toBe(mode);
    expect(host("ComposeText")?.props.color).toBe(makeThemeColors(mode).foreground);
    expect(host("ComposeText")?.props.children).toBe("Theme");
    expect(host("ComposeText")?.props.style).toMatchObject({ fontSize: 16, lineHeight: 22 });
    expect(host("ComposeText")?.props.maxLines).toBe(1);
  });
  it("updates label and Host together when the system theme changes without remounting", () => {
    runtime.systemTheme = "dark";
    const h = mount("system");
    expect(host("ComposeText")?.props.color).toBe(makeThemeColors("dark").foreground);
    runtime.systemTheme = "light";
    h.update();
    expect(host("ComposeHost")?.props.colorScheme).toBe("light");
    expect(host("ComposeText")?.props.color).toBe(makeThemeColors("light").foreground);
  });
  it("preserves selected option and the native value-change callback", () => {
    const h = mount("dark");
    expect(host("NativePicker")?.props.selectedValue).toBe("system");
    expect(tree?.root.findAll((node) => String(node.type) === "NativePickerItem")).toHaveLength(3);
    act(() => host("NativePicker")?.props.onValueChange("light"));
    expect(h.onValueChange).toHaveBeenCalledExactlyOnceWith("light");
  });
});

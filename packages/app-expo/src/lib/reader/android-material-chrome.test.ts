import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ANDROID_CHROME_FILES = [
  "../../platform/android/reader/ReaderBottomToolbar.tsx",
  "../../platform/android/ui/NativeButton.tsx",
  "../../platform/android/ui/NativeContextMenuButton.tsx",
] as const;

describe("Android reader Material chrome", () => {
  it.each(ANDROID_CHROME_FILES)("renders %s with vector Material icons", (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");

    expect(source).toContain('from "@expo/vector-icons/MaterialIcons"');
    expect(source).not.toContain('from "@/components/ui/Icon"');
  });
});

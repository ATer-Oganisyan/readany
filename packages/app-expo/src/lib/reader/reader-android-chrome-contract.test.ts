import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("Android reader chrome contract", () => {
  it("keeps the native header hidden while a catalog book is loading", () => {
    const reader = read("../../screens/ReaderScreen.tsx");
    const loadingChrome = reader
      .split("function ReaderLoadingChrome")[1]
      .split("function ReaderContent")[0];

    expect(loadingChrome).toContain('if (process.env.EXPO_OS === "android")');
    expect(loadingChrome).toContain("navigation.setOptions({ headerShown: false })");
  });

  it("shows only the reader-owned close control on Android loading chrome", () => {
    const reader = read("../../screens/ReaderScreen.tsx");
    const loadingChrome = reader
      .split("function ReaderLoadingChrome")[1]
      .split("function ReaderContent")[0];

    expect(loadingChrome).toContain("<ReaderTopBar");
    expect(loadingChrome).toContain("showTrailingActions={false}");
    expect(loadingChrome).toContain("onClosePress={() => navigation.goBack()}");
  });

  it("removes the unused animated SVG only in Android WebView", () => {
    const reader = read("../../screens/ReaderScreen.tsx");

    expect(reader).toContain('Platform.OS === "android"');
    expect(reader).toContain('document.getElementById("book-page-loader")?.remove()');
    expect(reader).toContain("injectedJavaScript={ANDROID_READER_BOOTSTRAP_SCRIPT}");
  });
});

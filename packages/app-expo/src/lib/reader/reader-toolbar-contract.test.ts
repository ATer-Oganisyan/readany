import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("iOS reader toolbar contract", () => {
  it("uses the compact localized stop action", () => {
    const toolbar = read("../../screens/reader/ReaderToolbar.ios.tsx");

    expect(toolbar).toContain('speechStopLabel={t("tts.stopShort", "Стоп")}');
    expect(toolbar).not.toContain('speechStopLabel={t("common.stop"');
  });

  it("keeps native toolbar titles on one line while preserving their accessible names", () => {
    const nativeControls = read(
      "../../../modules/native-controls/ios/ReadAnyNativeControlsModule.swift",
    );
    const readerToolbar = nativeControls
      .split("final class ReadAnyReaderToolbar")[1]
      .split("final class ReadAnySceneToolbar")[0];

    expect(readerToolbar).toContain("button.titleLabel?.numberOfLines = 1");
    expect(readerToolbar).toContain("button.titleLabel?.adjustsFontSizeToFitWidth = true");
    expect(readerToolbar).toContain("button.titleLabel?.minimumScaleFactor = 0.85");
    expect(readerToolbar).toContain(
      "button.setContentCompressionResistancePriority(.required, for: .horizontal)",
    );
    expect(readerToolbar).toContain("button.accessibilityLabel = title");
    expect(readerToolbar).toContain("speechItem.accessibilityLabel = currentSpeechLabel");
  });

  it("shows only a content-sized system spinner while loading", () => {
    const nativeControls = read(
      "../../../modules/native-controls/ios/ReadAnyNativeControlsModule.swift",
    );
    const readerToolbar = nativeControls
      .split("final class ReadAnyReaderToolbar")[1]
      .split("final class ReadAnySceneToolbar")[0];

    expect(readerToolbar).toContain("isLoading: speechLoading");
    expect(readerToolbar).toContain("configuration.title = isLoading ? nil : title");
    expect(readerToolbar).toContain("configuration.image = isLoading ? nil : image");
    expect(readerToolbar).toContain("configuration.showsActivityIndicator = isLoading");
    expect(readerToolbar).not.toContain("speechLoadingIndicator");
  });
});

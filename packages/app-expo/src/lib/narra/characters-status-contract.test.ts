import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screen = readFileSync(
  new URL("../../screens/NarraCharactersScreen.tsx", import.meta.url),
  "utf8",
);
const ruCommon = JSON.parse(
  readFileSync(
    new URL("../../../../core/src/i18n/locales/ru/common.json", import.meta.url),
    "utf8",
  ),
) as {
  narra: {
    findingCharacters: string;
    characterProfilePreparing: string;
  };
};

describe("characters processing status", () => {
  it("shows the processing subtitle and a disabled state for preliminary characters", () => {
    expect(screen).toContain('const isFindingCharacters = analysisAvailability === "processing"');
    expect(screen).toContain('t("narra.findingCharacters", "Ищу персонажей…")');
    expect(screen).toContain('backendStatus.preview?.status === "preview_ready"');
    expect(screen).not.toContain('charactersStatus === "full_ready"');
    expect(screen).toContain('t("narra.characterProfilePreparing", "Профиль формируется…")');
    expect(screen).toContain("disabled: true");
    expect(screen).toContain("dimmed: true");
    expect(screen).not.toContain("Размечаю книгу…");
    expect(screen).not.toContain("preparing:");
    expect(ruCommon.narra.findingCharacters).toBe("Ищу персонажей…");
    expect(ruCommon.narra.characterProfilePreparing).toBe("Профиль формируется…");
  });
  it("reports a terminal analysis failure through the standard retry toast", () => {
    expect(screen).toContain("useAnalysisFailureToast(bookId, isActive)");
    expect(screen).not.toContain("Разметка книги остановлена");
    expect(screen).not.toContain("errorDetail");
  });
});

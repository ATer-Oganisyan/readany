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
) as { narra: { findingCharacters: string } };

describe("characters processing status", () => {
  it("shows the processing state in Narra's subtitle without a separate status row", () => {
    expect(screen).toContain('backendStatus?.manifest?.availability === "processing"');
    expect(screen).toContain('t("narra.findingCharacters", "Ищу персонажей…")');
    expect(screen).not.toContain("Размечаю книгу…");
    expect(ruCommon.narra.findingCharacters).toBe("Ищу персонажей…");
  });
  it("renders an explicit terminal state and user-triggered retry without leaking details", () => {
    expect(screen).toContain('analysisAvailability === "failed"');
    expect(screen).toContain('analysisAvailability === "cancelled"');
    expect(screen).toContain('t("narra.retryAnalysis", "Повторить разметку")');
    expect(screen).toContain("retryBackendBookAnalysis(bookId)");
    expect(screen).not.toContain("errorDetail");
  });
});

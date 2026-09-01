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
    expect(screen).not.toContain("Профиль формируется…");
    expect(screen).not.toContain("preparing:");
    expect(ruCommon.narra.findingCharacters).toBe("Ищу персонажей…");
  });
  it("reports a terminal analysis failure through the standard retry toast", () => {
    expect(screen).toContain('analysisAvailability === "failed"');
    expect(screen).toContain('analysisAvailability === "cancelled"');
    expect(screen).toContain(
      'toast.error(t("narra.analysisFailed", "Не удалось подготовить книгу")',
    );
    expect(screen).toContain('label: t("common.retry", "Повторить")');
    expect(screen).toContain("retryBackendBookAnalysis(bookId)");
    expect(screen).not.toContain("Разметка книги остановлена");
    expect(screen).not.toContain("errorDetail");
  });
});

import i18n, { i18nReady } from "@readany/core/i18n";
import { describe, expect, it } from "vitest";
import { localizeNarraErrorMessage, normalizeNarraError } from "./errors";

describe("Narra error localization", () => {
  it("translates existing errors without changing retry inputs", async () => {
    await i18nReady;
    const error = normalizeNarraError(new Error("TIMEOUT"));
    const original = error.message;
    await i18n.changeLanguage("en");
    expect(localizeNarraErrorMessage(error.message)).toBe(
      "The service is taking longer than usual. Please try again.",
    );
    await i18n.changeLanguage("ru");
    expect(localizeNarraErrorMessage(error.message)).toBe(original);
    expect(error.message).toBe(original);
  });

  it("translates damaged audio and handles unknown service messages", async () => {
    await i18nReady;
    await i18n.changeLanguage("en");
    expect(localizeNarraErrorMessage("Сервис вернул пустой или повреждённый звук.")).toBe(
      "The service returned empty or damaged audio.",
    );
    expect(localizeNarraErrorMessage("Backend internal error")).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

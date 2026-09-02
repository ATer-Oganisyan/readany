import { describe, expect, it } from "vitest";
import { findBannedImport } from "./import-blocklist";

describe("findBannedImport", () => {
  it("блокирует запрещённый материал по названию", () => {
    expect(findBannedImport("Майн Кампф")).toBeDefined();
    expect(findBannedImport("Mein Kampf")).toBeDefined();
  });

  it("блокирует по имени файла, когда метаданных нет", () => {
    expect(findBannedImport(undefined, undefined, "mein-kampf.epub")).toBeDefined();
  });

  it("«Моя борьба» блокируется только вместе с автором", () => {
    expect(findBannedImport("Моя борьба", "Адольф Гитлер")).toBeDefined();
    expect(findBannedImport("Моя борьба", "Карл Уве Кнаусгор")).toBeUndefined();
  });

  it("видит автора, записанного в имени файла или в названии", () => {
    // TXT: после конвертации автор пуст, а title равен имени файла без расширения.
    expect(findBannedImport(undefined, undefined, "Моя борьба - Адольф Гитлер.txt")).toBeDefined();
    expect(findBannedImport("Моя борьба - Адольф Гитлер", "")).toBeDefined();
    expect(findBannedImport(undefined, undefined, "Моя борьба - Кнаусгор.epub")).toBeUndefined();
  });

  it("не трогает классику с тяжёлыми темами и обычные книги", () => {
    expect(findBannedImport("Преступление и наказание", "Фёдор Достоевский")).toBeUndefined();
    expect(findBannedImport("Пятьдесят оттенков серого", "Э. Л. Джеймс")).toBeUndefined();
    expect(findBannedImport("Камасутра")).toBeUndefined();
    expect(findBannedImport("Война и мир", "Лев Толстой")).toBeUndefined();
  });

  it("нормализует ё, регистр и разделители", () => {
    expect(findBannedImport("ДНЕВНИКИ ТЁРНЕРА")).toBeDefined();
    expect(findBannedImport(undefined, undefined, "The_Anarchist-Cookbook.pdf")).toBeDefined();
  });
});

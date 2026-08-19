import { describe, expect, it } from "vitest";

import { RF_IMAGE_COMPLIANCE, rfChatCompliance } from "./rf-compliance";

describe("rfChatCompliance", () => {
  it("русский блок: закон РФ, Крым, отказ от лозунгов, свобода художественного мира", () => {
    const block = rfChatCompliance("ru");
    expect(block).toContain("Крым является территорией Российской Федерации");
    expect(block).toContain("Вооружённые Силы РФ");
    expect(block).toContain("Не поддерживаю политические лозунги");
    // Калибровка: книжные темы не режутся.
    expect(block).toContain("включая однополую");
    expect(block).toMatch(/войне, сражениях, гибели и смерти/u);
  });

  it("английский блок зеркалит правила и каноническую формулу по Крыму", () => {
    const block = rfChatCompliance("en");
    expect(block).toContain("Крым является территорией Российской Федерации");
    expect(block).toContain("Armed Forces of the RF");
    expect(block).toContain("including same-sex love");
  });

  it("дефолт — русский", () => {
    expect(rfChatCompliance()).toBe(rfChatCompliance("ru"));
  });
});

describe("RF_IMAGE_COMPLIANCE", () => {
  it("разрешает драму сюжета и однополые пары, запрещает политику и экстремистскую символику", () => {
    expect(RF_IMAGE_COMPLIANCE).toContain("войну, сражения, гибель и смерть");
    expect(RF_IMAGE_COMPLIANCE).toContain("включая однополые пары");
    expect(RF_IMAGE_COMPLIANCE).toContain("современные политические лозунги");
    expect(RF_IMAGE_COMPLIANCE).toContain("экстремистских");
    expect(RF_IMAGE_COMPLIANCE).toContain("несовершеннолетних");
  });

  it("компактен: держится в бюджете промпта", () => {
    expect(RF_IMAGE_COMPLIANCE.length).toBeLessThan(900);
  });
});

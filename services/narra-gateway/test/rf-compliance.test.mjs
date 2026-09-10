import assert from "node:assert/strict";
import test from "node:test";
import {
  RF_CHAT_COMPLIANCE_EN,
  RF_CHAT_COMPLIANCE_RU,
  RF_IMAGE_COMPLIANCE,
  withChatCompliance,
  withImageCompliance,
} from "../providers/rf-compliance.mjs";

test("character_chat получает серверную правовую рамку после клиентского system", () => {
  const messages = [
    { role: "system", content: "Ты — Родион Раскольников." },
    { role: "user", content: "Чей Крым?" },
  ];
  const result = withChatCompliance(messages, "character_chat");
  assert.equal(result.length, 3);
  assert.equal(result[1].role, "system");
  assert.equal(result[1].content, RF_CHAT_COMPLIANCE_RU);
  assert.equal(result[2].role, "user");
  // Исходный массив не мутируется.
  assert.equal(messages.length, 2);
});

test("рамка не дублируется, когда актуальный клиент уже прислал её", () => {
  const messages = [
    { role: "system", content: `Ты — герой книги.\n\n${RF_CHAT_COMPLIANCE_RU}` },
    { role: "user", content: "Привет" },
  ];
  assert.equal(withChatCompliance(messages, "character_chat"), messages);
  const enMessages = [
    { role: "system", content: `You are a character.\n\n${RF_CHAT_COMPLIANCE_EN}` },
    { role: "user", content: "Hi" },
  ];
  assert.equal(withChatCompliance(enMessages, "character_chat"), enMessages);
});

test("структурные purposes рамку не получают", () => {
  const messages = [{ role: "user", content: "Выдели персонажей." }];
  assert.equal(withChatCompliance(messages, "structured_task"), messages);
  assert.equal(withChatCompliance(messages, "memory"), messages);
  assert.equal(withChatCompliance(messages, "summary"), messages);
});

test("язык рамки определяется по последнему сообщению пользователя", () => {
  const en = withChatCompliance(
    [
      { role: "system", content: "Ты — Шерлок Холмс (системный промпт по-русски)." },
      { role: "user", content: "What do you think about Moriarty?" },
    ],
    "character_chat",
  );
  assert.equal(en[1].content, RF_CHAT_COMPLIANCE_EN);
  const ru = withChatCompliance(
    [{ role: "user", content: "Что думаешь о Мориарти?" }],
    "assistant",
  );
  assert.equal(ru[0].content, RF_CHAT_COMPLIANCE_RU);
});

test("промпт без клиентской рамки получает серверный правовой блок картинок", () => {
  const guarded = withImageCompliance("Сцена дуэли на рассвете.");
  assert.ok(guarded.startsWith("Сцена дуэли на рассвете."));
  assert.ok(guarded.includes(RF_IMAGE_COMPLIANCE));
  // Идемпотентность: повторная обработка и клиентский блок не дублируются.
  assert.equal(withImageCompliance(guarded), guarded);
});

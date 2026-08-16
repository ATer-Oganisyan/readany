import { describe, expect, it } from "vitest";
import {
  resolveCharacterConversationLanguage,
  shouldReplaceLegacyGeneratedGreeting,
} from "./character-conversation-language";

describe("character conversation language", () => {
  it("uses the declared Russian book language instead of the English interface", () => {
    expect(
      resolveCharacterConversationLanguage({
        declaredLanguage: "ru-RU",
        samples: ["The English interface must not win"],
        fallbackLanguage: "en",
      }),
    ).toBe("ru");
  });

  it("uses the declared English book language instead of the Russian interface", () => {
    expect(
      resolveCharacterConversationLanguage({
        declaredLanguage: "eng",
        samples: ["Русская локализация интерфейса не должна победить"],
        fallbackLanguage: "ru",
      }),
    ).toBe("en");
  });

  it("detects Cyrillic book metadata when the EPUB language is missing", () => {
    expect(
      resolveCharacterConversationLanguage({
        samples: ["Преступление и наказание", "Фёдор Достоевский", "Родион Раскольников"],
        fallbackLanguage: "en",
      }),
    ).toBe("ru");
  });

  it("detects Latin book metadata when the EPUB language is missing", () => {
    expect(
      resolveCharacterConversationLanguage({
        samples: ["The Murders in the Rue Morgue", "Edgar Allan Poe", "Auguste Dupin"],
        fallbackLanguage: "ru",
      }),
    ).toBe("en");
  });

  it("falls back to the interface only without reliable book evidence", () => {
    expect(
      resolveCharacterConversationLanguage({
        declaredLanguage: "und",
        samples: ["123"],
        fallbackLanguage: "en",
      }),
    ).toBe("en");
  });

  it("replaces a lone legacy English greeting for a Russian book", () => {
    expect(
      shouldReplaceLegacyGeneratedGreeting({
        messages: [
          {
            id: "old-greeting",
            role: "assistant",
            content: "Good day, my friend. I am glad to meet you.",
            createdAt: 1,
          },
        ],
        canonicalGreeting: "Здравствуйте. Рад нашей встрече.",
        conversationLanguage: "ru",
      }),
    ).toBe(true);
  });

  it("never rewrites a conversation after the reader has answered", () => {
    expect(
      shouldReplaceLegacyGeneratedGreeting({
        messages: [
          {
            id: "old-greeting",
            role: "assistant",
            content: "Good day, my friend.",
            createdAt: 1,
          },
          { id: "reader", role: "user", content: "Здравствуйте", createdAt: 2 },
        ],
        canonicalGreeting: "Здравствуйте.",
        conversationLanguage: "ru",
      }),
    ).toBe(false);
  });
});

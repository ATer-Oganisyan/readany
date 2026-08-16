import type { NarraChatMessage } from "./types";

export type CharacterConversationLanguage = "ru" | "en";

interface CharacterConversationLanguageInput {
  declaredLanguage?: string;
  samples?: Array<string | null | undefined>;
  fallbackLanguage: CharacterConversationLanguage;
}

function normalizeDeclaredLanguage(language?: string): CharacterConversationLanguage | null {
  const normalized = language?.trim().toLocaleLowerCase().replaceAll("_", "-");
  if (!normalized || normalized === "und") return null;

  const baseLanguage = normalized.split("-")[0];
  if (["ru", "rus", "russian", "русский"].includes(baseLanguage)) return "ru";
  if (["en", "eng", "english", "английский"].includes(baseLanguage)) return "en";
  return null;
}

function detectLanguageFromSamples(
  samples: Array<string | null | undefined>,
): CharacterConversationLanguage | null {
  const sample = samples.filter(Boolean).join(" ");
  const cyrillicCount = sample.match(/[А-Яа-яЁё]/g)?.length ?? 0;
  const latinCount = sample.match(/[A-Za-z]/g)?.length ?? 0;

  if (cyrillicCount > latinCount) return "ru";
  if (latinCount > cyrillicCount) return "en";
  return null;
}

export function resolveCharacterConversationLanguage({
  declaredLanguage,
  samples = [],
  fallbackLanguage,
}: CharacterConversationLanguageInput): CharacterConversationLanguage {
  const normalizedLanguage = normalizeDeclaredLanguage(declaredLanguage);
  if (normalizedLanguage) return normalizedLanguage;

  return detectLanguageFromSamples(samples) ?? fallbackLanguage;
}

interface LegacyGreetingInput {
  messages: NarraChatMessage[];
  canonicalGreeting?: string;
  conversationLanguage: CharacterConversationLanguage;
}

export function shouldReplaceLegacyGeneratedGreeting({
  messages,
  canonicalGreeting,
  conversationLanguage,
}: LegacyGreetingInput): boolean {
  if (!canonicalGreeting || messages.length !== 1 || messages[0]?.role !== "assistant") {
    return false;
  }

  const existingGreeting = messages[0].content.trim();
  const replacementGreeting = canonicalGreeting.trim();
  if (!existingGreeting || !replacementGreeting || existingGreeting === replacementGreeting) {
    return false;
  }

  return (
    detectLanguageFromSamples([existingGreeting]) !== conversationLanguage &&
    detectLanguageFromSamples([replacementGreeting]) === conversationLanguage
  );
}

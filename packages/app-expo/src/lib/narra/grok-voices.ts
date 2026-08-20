/**
 * Каталог голосов Grok TTS и маппинг на коды озвучки Narra.
 *
 * Коды Narra (`Che`, `She`, `Ast`, …) остаются единственной точкой правды в
 * voice-rules/voice-markup, в карточках персонажей и в сохранённых планах книг.
 * Здесь они переводятся в голоса провайдера — только на границе синтеза, чтобы
 * смена провайдера не трогала канон озвучки.
 *
 * Пол голосов Grok в документации не указан; определён замером частоты
 * основного тона (автокорреляция, сэмплы 2026-08-20): мужские 90–138 Гц,
 * женские 168–232 Гц, разрыв между группами чистый.
 *
 * Полный список из 28 голосов проверен живыми запросами к
 * `x-ai/grok-voice-tts-1.0` через OpenRouter: несуществующее имя даёт 404,
 * поэтому список — фактический, а не документационный (в доке OpenRouter
 * перечислены только пять исходных голосов).
 */

import type { NarraGender } from "./types";
import { type NarraProsody, PROSODY_VARIANTS, VOICES } from "./voice-rules";

export interface GrokVoiceInfo {
  gender: NarraGender;
  /** Средняя частота основного тона, Гц — замер, для сортировки и отладки. */
  pitchHz: number;
}

export const GROK_VOICES: Readonly<Record<string, GrokVoiceInfo>> = {
  // Мужские, от низких к высоким.
  perseus: { gender: "male", pitchHz: 90 },
  helios: { gender: "male", pitchHz: 92 },
  orion: { gender: "male", pitchHz: 93 },
  rex: { gender: "male", pitchHz: 95 },
  zenith: { gender: "male", pitchHz: 101 },
  altair: { gender: "male", pitchHz: 111 },
  cosmo: { gender: "male", pitchHz: 116 },
  kepler: { gender: "male", pitchHz: 118 },
  lux: { gender: "male", pitchHz: 119 },
  naksh: { gender: "male", pitchHz: 119 },
  sirius: { gender: "male", pitchHz: 121 },
  zagan: { gender: "male", pitchHz: 121 },
  sal: { gender: "male", pitchHz: 124 },
  castor: { gender: "male", pitchHz: 125 },
  leo: { gender: "male", pitchHz: 128 },
  lumen: { gender: "male", pitchHz: 131 },
  rigel: { gender: "male", pitchHz: 131 },
  helix: { gender: "male", pitchHz: 133 },
  atlas: { gender: "male", pitchHz: 138 },
  // Женские, от низких к высоким.
  liora: { gender: "female", pitchHz: 168 },
  luna: { gender: "female", pitchHz: 170 },
  aurora: { gender: "female", pitchHz: 191 },
  eve: { gender: "female", pitchHz: 195 },
  ara: { gender: "female", pitchHz: 200 },
  ursa: { gender: "female", pitchHz: 205 },
  celeste: { gender: "female", pitchHz: 222 },
  carina: { gender: "female", pitchHz: 229 },
  iris: { gender: "female", pitchHz: 232 },
};

/** Голос, которым синтезируется всё, что не удалось разрешить. */
export const GROK_FALLBACK_VOICE = "aurora";

/**
 * Код Narra → голос Grok. Пол сохранён; внутри пола голоса разнесены по
 * тону, чтобы персонажи одной книги звучали различимо.
 */
export const NARRA_VOICE_TO_GROK: Readonly<Record<string, string>> = {
  // Ассистентские: нарратор (ж/м) и второй ассистентский голос.
  Che: "aurora", // Афина — женский нарратор по умолчанию
  She: "atlas", // Сбер — мужской нарратор
  Erm: "eve", // Джой
  // Актёрский пул.
  Efo: "orion", // Фокин
  Ast: "rex", // Стерлинг
  Gal: "cosmo", // Галустьян
  Ste: "celeste", // Стремпаржевская
  Tso: "liora", // Цокаева
  Bez: "perseus", // Безлепкин
  Ego: "sal", // Егоров
  Chr: "ara", // Чернышова
  Izv: "helios", // Изволов
  Saf: "carina", // Сафронова — мягкий тембр, приоритет детским книгам
  Kov: "leo", // Ковалев
  // Пасхалки.
  Mar: "zagan", // Марков
  Kas: "zenith", // Пират — самый низкий из свободных
};

/**
 * Голоса, не занятые прямым маппингом. Используются вместо просодии:
 * Grok не поддерживает ни pitch, ни rate, поэтому «тот же голос с другой
 * высотой» заменяется на другой голос того же пола — различимость выше,
 * чем у сдвига тона.
 */
const SPARE_VOICES: Readonly<Record<NarraGender, readonly string[]>> = {
  male: ["altair", "kepler", "lux", "naksh", "sirius", "castor", "lumen", "rigel", "helix"],
  female: ["luna", "ursa", "iris"],
};

/**
 * Порядковый номер варианта в каноническом наборе PROSODY_VARIANTS. Индекс, а
 * не хеш: набор фиксирован, поэтому соседние варианты гарантированно попадают
 * в разные голоса запасного пула.
 */
function prosodyVariantIndex(prosody: NarraProsody): number {
  const index = PROSODY_VARIANTS.findIndex(
    (variant) =>
      (variant.pitch ?? 0) === (prosody.pitch ?? 0) && (variant.rate ?? 1) === (prosody.rate ?? 1),
  );
  if (index >= 0) return index;
  // Просодия не из канона (ручная правка) — стабильный запасной хеш.
  const pitch = Math.round((prosody.pitch ?? 0) * 10);
  const rate = Math.round((prosody.rate ?? 1) * 100);
  return Math.abs(pitch * 31 + rate);
}

/**
 * Голос Grok для кода Narra. Просодия (сигнал «актёрский пул исчерпан»)
 * переводится в отдельный голос того же пола; если запас кончился — возвращает
 * базовый голос, как и раньше повторяя тембр.
 */
export function resolveGrokVoice(narraVoice: string, prosody?: NarraProsody): string {
  const base = NARRA_VOICE_TO_GROK[narraVoice];
  if (!base) return GROK_FALLBACK_VOICE;
  if (!prosody || (prosody.pitch === undefined && prosody.rate === undefined)) return base;

  const gender = VOICES[narraVoice]?.gender ?? GROK_VOICES[base].gender;
  const spares = SPARE_VOICES[gender];
  if (spares.length === 0) return base;
  return spares[prosodyVariantIndex(prosody) % spares.length];
}

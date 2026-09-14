/**
 * От какого лица ведётся книга и где в ней говорит рассказчик.
 *
 * Рассказчик книги от первого лица — самый трудный персонаж для счётчика имён:
 * сам себя он называет «я», а по имени его зовут только собеседники. У «Игрока»
 * первое «Алексей Иванович» приходится на 78 364-й знак — на 28 % книги, — и
 * главный герой, который рассказывает с первой строки, оказывался позади
 * эпизодических лиц и заперт до четверти книги.
 *
 * Отдельный модуль, потому что примитивы нужны двоим: инвентарь по ним узнаёт
 * рассказчика, а сборщик фрагментов берёт по ним его свидетельства. В книге от
 * первого лица его собственные слова и есть то, чем подтверждается его
 * карточка, — и они начинаются с первой страницы, а не с первого называния.
 */

const WORD_PATTERN = /\p{L}+(?:[-'’ʼ]\p{L}+)*/gu

/**
 * Личные местоимения первого лица единственного числа. Притяжательные («мой»,
 * «my») сюда не входят: в речи они есть у каждого говорящего и отличают не
 * рассказчика, а реплику.
 */
export const FIRST_PERSON_WORDS = new Set([
  'я', 'меня', 'мне', 'мной', 'мною',
  'i', 'me', 'myself'
])

/** Абзац-реплика: тот же признак, которым считается `dialogueDashRate`. */
export function isDialogueParagraph(source, paragraph) {
  return /^[—–-]\s/.test(source.slice(paragraph.startOffset, paragraph.startOffset + 3))
}

/**
 * Смещение первого «я» в тексте абзаца, или -1. Смещение, а не флаг: цитата
 * строится вокруг упоминания, и рассказчику она нужна вокруг его собственного
 * слова, а не от начала абзаца.
 */
export function firstPersonMentionAt(text) {
  for (const match of text.matchAll(WORD_PATTERN)) {
    if (FIRST_PERSON_WORDS.has(match[0].toLowerCase())) return match.index
  }
  return -1
}

/**
 * Доля повествовательных абзацев, в которых говорит «я».
 *
 * Считается вне реплик: в книге от третьего лица «я» живёт только внутри чужой
 * прямой речи, которая сюда не попадает.
 */
export function bookNarrationPerson(source, textIndex) {
  let narrative = 0
  let firstPerson = 0
  for (const paragraph of textIndex.paragraphs) {
    if (isDialogueParagraph(source, paragraph)) continue
    const text = source.slice(paragraph.startOffset, paragraph.endOffset)
    if (!/\p{L}/u.test(text)) continue
    narrative += 1
    if (firstPersonMentionAt(text) >= 0) firstPerson += 1
  }
  return {
    narrativeParagraphs: narrative,
    firstPersonParagraphs: firstPerson,
    firstPersonShare: narrative > 0
      ? Math.round((firstPerson / narrative) * 10_000) / 10_000
      : 0
  }
}

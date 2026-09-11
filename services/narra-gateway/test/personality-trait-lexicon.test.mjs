/**
 * Словарь черт личности по-русски.
 *
 * Тест написан по итогам мерки, а не из общих соображений: **ни один из 3098
 * абзацев «Преступления и наказания» не совпадал с английскими шаблонами
 * прямого авторского утверждения**, а таблицы сравнивались строкой, из-за чего
 * «красивый» отбрасывался как внешность, а «красивая» проходила как черта
 * характера. Продукт читают по-русски, поэтому русский случай здесь основной, а
 * английский проверяется на то, что он не сдвинулся.
 *
 * Цитаты — подлинные, из текста той редакции, чей sha256 записан в
 * `evaluation/identity/prestuplenie-i-nakazanie-ru-v1.json`.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APPEARANCE_TRAIT_EVIDENCE,
  BLOCKED_TRAIT_KEYS,
  CORRECTED_HEARSAY_TRAIT_EVIDENCE,
  DIRECT_ONLY_TRAIT_KEYS,
  NEGATED_TRAIT_PATTERNS,
  PERSONALITY_LEXICON_VERSION,
  TRAIT_CONFLICT_KEYS,
  durableTraitPhrasing,
  quoteNamesTrait,
  traitConceptKey,
  traitMentionIndices,
  traitStem
} from '../analysis/personality-trait-lexicon.mjs'
import { filterStableTraits } from '../generation/internal-generation-service.mjs'

/** Прасковья Павловна: прямое «всегда была застенчива» рядом с внешностью. */
const ZASTENCHIVA = 'Она и всегда была застенчива и с тягостию переносила разговоры и ' +
  'объяснения; ей было лет сорок, и она была толста и жирна, черноброва и черноглаза, ' +
  'добра от толстоты и лености; и собою даже очень смазлива.'
/** Именное сказуемое: «был человек властный». */
const VLASTNYJ = 'Уж, конечно, это был человек властный и короткий в доме.'
/** Выражение лица — внешность, а не характер. */
const LICO = '— Ну, да уж конечно! — произнес он отрывисто, и выражение лица его, ' +
  'и звук голоса опять вдруг переменились.'

function evidence(rows) {
  return new Map(rows.map(([id, type, quote, startOffset]) =>
    [id, { id, type, fact: '', quote, startOffset, confidence: 1 }]))
}

function claim(value, evidenceIds, confidence = 0.9) {
  return { value, evidenceIds, confidence }
}

const CRIME_EVIDENCE = evidence([
  ['f1', 'character_action', ZASTENCHIVA, 100],
  ['f2', 'character_action', VLASTNYJ, 50_000],
  ['f3', 'character_trait', LICO, 90_000]
])

const audit = (claims) => filterStableTraits(claims, CRIME_EVIDENCE, 1_000_000, { sceneGap: 1 })
  .map(({ value }) => value)

test('one Russian lexeme in every grammatical form is one concept, not five', () => {
  // Ровно то, что было сломано: таблицы сравнивались строкой, и «добрая» с
  // «добрый» жили как две разные черты одного человека.
  const forms = ['добрый', 'добрая', 'доброго', 'добра', 'добрейший', 'добрым', 'добрую']
  assert.equal(new Set(forms.map((form) => traitConceptKey(form))).size, 1)
  assert.equal(traitConceptKey('добрая'), traitConceptKey('добрый'))
})

test('a short Russian adjective stems to two letters, and that is why the floor is two', () => {
  // «злой» и «злая» сводятся только основой «зл»; порог в четыре буквы оставлял
  // их разными концептами.
  assert.equal(traitStem('злой'), 'зл')
  assert.equal(traitConceptKey('злая'), traitConceptKey('злой'))
  // Короткая основа сравнивается лишь на полное равенство, поэтому склейки с
  // соседними словами не возникает.
  assert.notEqual(traitConceptKey('злой'), traitConceptKey('злоба'))
})

test('Russian synonyms collapse to one concept', () => {
  for (const [from, to] of [
    ['добродушная', 'добрый'],
    ['робкая', 'застенчивый'],
    ['храбрая', 'смелый'],
    ['надменная', 'высокомерный'],
    ['жадная', 'скупой'],
    ['лживая', 'нечестный'],
    ['смиренная', 'кроткий']
  ]) {
    assert.equal(traitConceptKey(from), traitConceptKey(to), `${from} → ${to}`)
  }
})

test('appearance, age, wealth and bodily state are refused in every inflected form', () => {
  for (const word of [
    'красивая', 'прекрасная', 'бледная', 'статная', 'седая',
    'молодая', 'пожилой', 'богатая', 'нищая',
    'талантливая', 'образованная', 'пьяная', 'усталая', 'красноречивая'
  ]) {
    assert.ok(BLOCKED_TRAIT_KEYS.has(traitConceptKey(word)), `${word} должна быть запрещена`)
  }
  for (const word of ['добрая', 'смелая', 'честная', 'гордая', 'кроткая']) {
    assert.equal(BLOCKED_TRAIT_KEYS.has(traitConceptKey(word)), false, `${word} — черта`)
  }
})

test('a Russian mood needs a direct authorial statement before it counts as a trait', () => {
  for (const word of ['мрачная', 'угрюмый', 'грустная', 'встревоженная', 'растерянный']) {
    assert.ok(DIRECT_ONLY_TRAIT_KEYS.has(traitConceptKey(word)), word)
  }
})

test('Russian antonyms are strict pairs, keyed by stem', () => {
  const pairs = TRAIT_CONFLICT_KEYS.map(([left, right]) => `${left}|${right}`)
  assert.ok(pairs.includes(`${traitConceptKey('добрый')}|${traitConceptKey('жестокий')}`))
  assert.ok(pairs.includes(`${traitConceptKey('щедрый')}|${traitConceptKey('скупой')}`))
  // Пара «гордый / скромный» здесь намеренно отсутствует: правило снимает обе
  // черты при равной силе, а в романе человек бывает и тем, и другим.
  assert.equal(
    pairs.includes(`${traitConceptKey('гордый')}|${traitConceptKey('скромный')}`),
    false
  )
})

test('a quote that contradicts the trait is caught in Russian, not only in English', () => {
  assert.ok(NEGATED_TRAIT_PATTERNS.get(traitConceptKey('добрая'))
    .test('старуха была жестока к сестре'))
  assert.ok(NEGATED_TRAIT_PATTERNS.get(traitConceptKey('честная'))
    .test('он лгал не краснея'))
  assert.ok(NEGATED_TRAIT_PATTERNS.get(traitConceptKey('смелая'))
    .test('он струсил и отступил'))
})

test('a stem is not allowed to swallow a different word', () => {
  // Первая версия правила была слишком щедра: «добр» оказывался началом
  // «добродетель», «высок» — началом «высокомерный», «само» — началом
  // «самоотверженный», и мерка по «Преступлению и наказанию» дала 358 пар
  // «черта — абзац» вместо 202.
  assert.equal(quoteNamesTrait('добрый', 'пьянство не добродетель'), false)
  assert.equal(quoteNamesTrait('высокомерный', 'под самою кровлей высокого дома'), false)
  assert.equal(quoteNamesTrait('самоотверженный', 'встречи с своею хозяйкой'), false)
  // Падежные и родовые формы остаются той же лексемой.
  assert.ok(quoteNamesTrait('честный', 'была очень честна'))
  assert.ok(quoteNamesTrait('гордый', 'он гордился ею'))
  assert.ok(quoteNamesTrait('высокомерный', 'говорила высокомерным тоном'))
})

test('a permanent-disposition phrase has to stand next to the trait it makes permanent', () => {
  // «всегда» из одного конца абзаца делало постоянным свойством «трусливое
  // ощущение» из другого — а абзац прямо говорит, что герой его стыдился.
  const far = 'И каждый раз молодой человек, проходя мимо, чувствовал какое-то ' +
    'болезненное и трусливое ощущение, которого стыдился и от которого морщился. ' +
    'Он был должен кругом хозяйке и всегда боялся с нею встретиться.'
  assert.equal(durableTraitPhrasing(far, 'трусливый'), false)
  assert.ok(durableTraitPhrasing(far), 'без черты проверяется вся цитата')
  assert.ok(durableTraitPhrasing('Она и всегда была застенчива.', 'застенчивая'))
})

test('punctuation and case in the quote do not hide the trait', () => {
  // Слово из живой цитаты приходит с точкой и с заглавной, а основы, с которыми
  // идёт сравнение, нормализованы. Из-за этого «Он от природы был злым» черту
  // сохраняло, а «Он от природы был злым.» снимало как single_scene: точка
  // делала слово тем, которого правило не узнаёт.
  for (const quote of [
    'Он от природы был злым',
    'Он от природы был злым.',
    '«Он от природы был злым!»',
    'ОН ОТ ПРИРОДЫ БЫЛ ЗЛЫМ'
  ]) {
    assert.ok(durableTraitPhrasing(quote, 'злой'), quote)
  }
  assert.deepEqual(traitMentionIndices('злой', ['Он', 'был', 'злым.']), [2])
  assert.deepEqual(traitMentionIndices('злой', ['Он', 'был', 'добрым.']), [])
})

test('the trait lexeme is found by stem, not by a five-letter prefix', () => {
  // «добрый» и «доброта» — одно слово, но их пятибуквенные префиксы разные
  // («добры» против «добро»), и прежнее правило их не сводило.
  assert.ok(quoteNamesTrait('добрый', 'в нём была великая доброта'))
  assert.ok(quoteNamesTrait('гордый', 'гордость не позволила ему просить'))
  assert.ok(quoteNamesTrait('честный', 'он поступил честно'))
  assert.equal(quoteNamesTrait('добрый', 'город спал'), false)
  assert.equal(quoteNamesTrait('милый', 'мир был тих'), false)
})

test('Russian phrasing of a permanent disposition is recognised', () => {
  for (const quote of [
    'Она и всегда была застенчива.',
    'Уж, конечно, это был человек властный и короткий в доме.',
    'человек он был нрава тихого',
    'Он был добр по натуре и от природы весел.',
    'Никогда не был он подозрителен.'
  ]) {
    assert.ok(durableTraitPhrasing(quote), quote)
  }
  for (const quote of [
    'Он вдруг рассердился и вышел.',
    'В эту минуту он показался ей мрачным.'
  ]) {
    assert.equal(durableTraitPhrasing(quote), false, quote)
  }
})

test('the English patterns still fire, so the eight English fixtures do not move', () => {
  assert.ok(durableTraitPhrasing('His pursuits have made him a very observant man.'))
  assert.ok(durableTraitPhrasing('She was habitually anxious.'))
  assert.equal(traitConceptKey('good-tempered'), 'good tempered')
  assert.equal(traitConceptKey('kindly'), 'kind')
  assert.ok(BLOCKED_TRAIT_KEYS.has('accomplished'))
  assert.ok(quoteNamesTrait('humble', 'Amy looked humble in her little effort.'))
})

test('a face is appearance and a refuted rumour is not a trait — in Russian too', () => {
  assert.ok(APPEARANCE_TRAIT_EVIDENCE.test(LICO))
  assert.ok(APPEARANCE_TRAIT_EVIDENCE.test('черты лица его были правильны'))
  // «на вид» здесь намеренно не ловится: оборот слишком част, и фильтр снимал бы
  // вместе с внешностью годные свидетельства характера.
  assert.equal(APPEARANCE_TRAIT_EVIDENCE.test('на вид ему было лет тридцать'), false)
  assert.ok(CORRECTED_HEARSAY_TRAIT_EVIDENCE.test('её считали гордою, но она была только робка'))
  assert.ok(CORRECTED_HEARSAY_TRAIT_EVIDENCE.test('он слыл дурным человеком, однако помогал всем'))
})

test('a single Dostoevsky paragraph that states a disposition outright yields a trait', () => {
  // Раньше это было невозможно: русского шаблона прямого утверждения не
  // существовало, поэтому одна цитата не давала черты ни в каком случае.
  assert.deepEqual(audit([claim('застенчивая', ['f1'])]), ['застенчивая'])
  assert.deepEqual(audit([claim('властный', ['f2'])]), ['властный'])
})

test('the same paragraph does not turn its appearance into character', () => {
  assert.deepEqual(audit([claim('толстая', ['f1'])]), [])
  assert.deepEqual(audit([claim('смазливая', ['f1'])]), [])
})

test('a mood claimed on a paragraph that never states it is refused', () => {
  assert.deepEqual(audit([claim('мрачная', ['f2'])]), [])
})

test('two synonyms of one concept collapse into a single trait', () => {
  const result = audit([
    claim('застенчивая', ['f1', 'f2']),
    claim('робкая', ['f1', 'f2'])
  ])
  assert.equal(result.length, 1)
})

test('the lexicon is versioned, because changing it changes every card', () => {
  assert.equal(PERSONALITY_LEXICON_VERSION, 'personality-trait-lexicon-ru-v1')
})

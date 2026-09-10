/**
 * Русские подсказки идентичности срабатывают.
 *
 * Все шесть были написаны с границами слова `\b`. В JavaScript `\b` определён по
 * ASCII: между пробелом и «ж» границы для него нет, поэтому `/\bжена\b/u` не
 * совпадает никогда. Мерка: из семи русских шаблонов резолвера не срабатывал ни
 * один, тогда как их английские половины работали. На русской книге резолвер
 * шёл без родственных и брачных подсказок вообще, и тесты этого не показывали —
 * восемь из десяти замороженных фикстур англоязычные.
 *
 * Тест держит обе письменности: русская — чтобы дефект не вернулся, английская —
 * чтобы поведение восьми фикстур не сдвинулось.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOK_IDENTITY_CUES,
  resolveBookAnalysisEntities
} from '../analysis/book-analysis-resolver.mjs'

const RUSSIAN = {
  spouse: [
    'его жена Катерина Ивановна',
    'муж её умер прошлой зимой',
    'супруга его была больна',
    'брак этот устроился быстро',
    'после свадьбы они уехали',
    'помолвка была назначена'
  ],
  distinctKinship: [
    'его сестра Дуня',
    'мать его писала письма',
    'у матери не было денег',
    'отец умер давно',
    'отца он не помнил',
    'дочь её сидела рядом',
    'дочери её плакали',
    'сын был в отставке',
    'сына он не видел',
    'брат его молчал',
    'братья молчали',
    'сестры её плакали',
    'родители не знали',
    'ребенок спал',
    'дети спали',
    'тетка её жила в деревне',
    'дядя приехал из губернии',
    'племянник его учился'
  ],
  letter: ['он получил письмо от матери', 'записка лежала на столе', 'послание было коротко'],
  letterSignature: ['подпись была неразборчива', 'автором письма была мать'],
  letterReply: ['она ответила ему тотчас', 'он отвечал сухо', 'поблагодарила за деньги'],
  signedName: ['подписался именем брата', 'подписалась как сестра']
}

const ENGLISH = {
  spouse: ['his wife Mary', 'her husband was away', 'they were married in spring'],
  distinctKinship: ['his sister Dunya', 'her mother wrote', 'the nephew arrived'],
  letter: ['he received a letter', 'a note lay on the table'],
  letterSignature: ['the signature was illegible', 'the signer was unknown'],
  letterReply: ['she answered at once', 'he replied dryly', 'thanked him'],
  signedName: ['he signs his name Ivan', 'she signed herself as a sister']
}

for (const [cue, samples] of Object.entries(RUSSIAN)) {
  test(`the Russian ${cue} cue fires`, () => {
    for (const sample of samples) {
      assert.ok(BOOK_IDENTITY_CUES[cue].test(sample), `${cue}: ${sample}`)
    }
  })
}

for (const [cue, samples] of Object.entries(ENGLISH)) {
  test(`the English ${cue} cue still fires`, () => {
    for (const sample of samples) {
      assert.ok(BOOK_IDENTITY_CUES[cue].test(sample), `${cue}: ${sample}`)
    }
  })
}

test('a cue does not fire on a Russian false friend', () => {
  // Это и была вторая половина дефекта: русские основы срезались префиксом, и
  // `жен\\p{L}*` совпадал с «женщина», а `муж\\p{L}*` — с «мужество» и «мужик»,
  // которых у Достоевского на страницу по нескольку. Подсказка гасила слияние
  // там, где о браке и родстве речи нет.
  for (const sample of ['женщина стояла у окна', 'мужество его удивило', 'мужик бил клячу',
    'мужчина вышел из каморки']) {
    assert.equal(BOOK_IDENTITY_CUES.spouse.test(sample), false, sample)
    assert.equal(BOOK_IDENTITY_CUES.distinctKinship.test(sample), false, sample)
  }
  assert.equal(BOOK_IDENTITY_CUES.distinctKinship.test('материя была дешёвая'), false)
  assert.equal(BOOK_IDENTITY_CUES.distinctKinship.test('сынишка бегал по двору'), false)
  assert.equal(BOOK_IDENTITY_CUES.distinctKinship.test('тетрадь лежала на столе'), false)
  assert.equal(BOOK_IDENTITY_CUES.letter.test('письменный стол'), false)
  assert.equal(BOOK_IDENTITY_CUES.letterReply.test('ответственный человек'), false)
  assert.equal(BOOK_IDENTITY_CUES.letterSignature.test('подписчик газеты'), false)
})

test('two women of one surname stay two characters when a kinship observation names them', () => {
  const observation = ({ id, type, candidate, related = [], quote, fact, startOffset, kind = 'character' }) => ({
    id,
    observationKey: id,
    type,
    entityKind: kind,
    entityCandidate: candidate,
    relatedEntityCandidates: related,
    fact,
    evidence: { quote, startOffset, endOffset: startOffset + quote.length, chapterKey: 'chapter-1' },
    confidence: 0.92
  })
  const characters = resolveBookAnalysisEntities({
    observations: [
      observation({
        id: '11111111-1111-4111-8111-1111111129b1',
        type: 'character_alias',
        candidate: 'Пульхерия Раскольникова',
        related: ['Раскольникова'],
        fact: 'female',
        quote: 'Пульхерию Раскольникову звали в доме просто Раскольникова.',
        startOffset: 100
      }),
      observation({
        id: '22222222-2222-4222-8222-2222222229b1',
        type: 'character_action',
        candidate: 'Пульхерия Раскольникова',
        fact: 'female',
        quote: 'Пульхерия Раскольникова написала сыну письмо.',
        startOffset: 200
      }),
      observation({
        id: '33333333-3333-4333-8333-3333333329b1',
        type: 'character_alias',
        candidate: 'Авдотья Раскольникова',
        related: ['Раскольникова'],
        fact: 'female',
        quote: 'Авдотью Раскольникову тоже называли Раскольникова.',
        startOffset: 300
      }),
      observation({
        id: '44444444-4444-4444-8444-4444444429b1',
        type: 'character_action',
        candidate: 'Авдотья Раскольникова',
        fact: 'female',
        quote: 'Авдотья Раскольникова вошла в комнату.',
        startOffset: 400
      }),
      observation({
        id: '66666666-6666-4666-8666-6666666629b1',
        type: 'relationship',
        kind: 'relationship',
        candidate: 'Пульхерия Раскольникова и Авдотья Раскольникова',
        related: ['Пульхерия Раскольникова', 'Авдотья Раскольникова'],
        fact: 'Пульхерия Раскольникова — мать Авдотьи Раскольниковой.',
        quote: 'Мать, Пульхерия Раскольникова, обняла дочь.',
        startOffset: 600
      })
    ]
  }).filter(({ entityKind }) => entityKind === 'character')

  assert.deepEqual(
    characters.map(({ canonicalName }) => canonicalName),
    ['Пульхерия Раскольникова', 'Авдотья Раскольникова']
  )
})

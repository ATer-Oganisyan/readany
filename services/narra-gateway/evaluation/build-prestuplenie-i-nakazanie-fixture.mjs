/**
 * Генератор gold-фикстуры `prestuplenie-i-nakazanie-ru-v1.json`.
 *
 * Фикстура — это цифры, а цифры без способа их пересчитать проверить нельзя.
 * Здесь записан весь ввод, который нельзя вывести из текста: gold-состав как
 * объединение четырёх ссылочных страниц, распределение общих фамилий и список
 * знакомых не-gold имён. Всё остальное — mentionCount, смещение первого
 * упоминания, ярус significant, хэш и длина текста — считается из текста.
 *
 *   node evaluation/build-prestuplenie-i-nakazanie-fixture.mjs \
 *     /tmp/crime.txt evaluation/identity/prestuplenie-i-nakazanie-ru-v1.json
 *
 * Текст берётся из каталога: `node evaluation/fetch-catalog-roster.mjs --book
 * bef16434-1e57-4088-a9e0-aa3883797e1f --out /tmp/crime.roster.json --text
 * /tmp/crime.txt`. Расхождение с зафиксированным sha256 означает, что издание
 * перегенерировали, и фикстуру надо пересобрать осознанно, а не молча.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  MENTION_COUNT_RULE,
  buildWordIndex,
  mentionStatistics,
  significantTier
} from './count-identity-mentions.mjs'

const TEXT_PATH = process.argv[2]
const OUT_PATH = process.argv[3]
const text = readFileSync(TEXT_PATH, 'utf8')
const words = buildWordIndex(text)

/**
 * Gold-состав — объединение четырёх ссылочных страниц (см. references[]).
 * Общая фамилия отдаётся тому, кого так называют эти страницы; пересечение
 * фиксируется в collisionGuards.
 */
const GOLD = [
  ['rodion_raskolnikov', 'Раскольников', ['Родион Раскольников', 'Родион Романович Раскольников', 'Родион Романович', 'Родион Романыч', 'Родион', 'Родя', 'Роденька', 'Родька']],
  ['sonya_marmeladova', 'Соня', ['Соня Мармеладова', 'Сонечка', 'Софья Семеновна', 'Софья Семёновна', 'Софья Семеновна Мармеладова', 'Софья']],
  ['katerina_marmeladova', 'Катерина Ивановна', ['Катерина Ивановна Мармеладова', 'Катерина']],
  ['dunya_raskolnikova', 'Авдотья Романовна', ['Дуня', 'Дунечка', 'Дуня Раскольникова', 'Авдотья Романовна Раскольникова', 'Авдотья']],
  ['pulcheria_raskolnikova', 'Пульхерия Александровна', ['Пульхерия Александровна Раскольникова', 'Пульхерия']],
  ['arkady_svidrigailov', 'Свидригайлов', ['Аркадий Иванович Свидригайлов', 'Аркадий Иванович']],
  ['porfiry_petrovich', 'Порфирий Петрович', ['Порфирий']],
  ['dmitry_razumikhin', 'Разумихин', ['Дмитрий Прокофьич Разумихин', 'Дмитрий Прокофьевич Разумихин', 'Дмитрий Прокофьич', 'Дмитрий Прокофьевич', 'Вразумихин']],
  ['pyotr_luzhin', 'Петр Петрович Лужин', ['Лужин', 'Петр Петрович', 'Пётр Петрович Лужин']],
  ['marfa_svidrigailova', 'Марфа Петровна', ['Марфа Петровна Свидригайлова', 'Марфа']],
  ['amalia_lippevekhzel', 'Амалия Ивановна Липпевехзель', ['Амалия Ивановна', 'Амалия Людвиговна', 'Амалия Федоровна', 'Липпевехзель', 'Амалия']],
  ['zosimov', 'Зосимов', []],
  ['zametov', 'Заметов', ['Александр Григорьевич Заметов', 'Александр Григорьевич']],
  ['nastasya', 'Настасья', ['Настенька']],
  ['andrey_lebezyatnikov', 'Андрей Семенович Лебезятников', ['Лебезятников', 'Андрей Семенович', 'Андрей Семёнович']],
  ['semyon_marmeladov', 'Мармеладов', ['Семен Захарович Мармеладов', 'Семен Захарович', 'Семен Захарыч', 'Семён Захарович']],
  ['lizaveta', 'Лизавета', ['Лизавета Ивановна']],
  ['nikolay_dementyev', 'Николай Дементьев', ['Миколка', 'Миколай Дементьев', 'Миколай', 'Николай']],
  ['nikodim_fomich', 'Никодим Фомич', ['Никодим']],
  ['ilya_petrovich', 'Илья Петрович', ['Порох']],
  ['alena_ivanovna', 'Алена Ивановна', ['Алёна Ивановна', 'Алена']],
  ['mitrey', 'Митрей', ['Митька']],
  ['reslich', 'Ресслих', ['Гертруда Карловна']],
  ['kapernaumov', 'Капернаумов', []],
  ['dushkin', 'Душкин', []],
  ['vakhrushin', 'Вахрушин', ['Афанасий Иванович Вахрушин', 'Афанасий Иванович']],
  ['chebarov', 'Чебаров', []],
  ['praskovya_zarnicyna', 'Прасковья Павловна', ['Зарницына']],
  ['darya_frantsevna', 'Дарья Францевна', []],
  ['luiza_ivanovna', 'Луиза Ивановна', ['Лавиза Ивановна']],
  ['natalya_egorovna', 'Наталья Егоровна', []]
]

const KNOWN_EXTRAS = [
  ['x_kokh', 'Кох', [], 'minor_character'],
  ['x_pestryakov', 'Пестряков', [], 'minor_character'],
  ['x_polechka', 'Полечка', ['Поленька', 'Поля'], 'minor_character'],
  ['x_kolya', 'Коля', [], 'minor_character'],
  ['x_lenya', 'Леня', ['Лидочка'], 'minor_character'],
  ['x_napoleon', 'Наполеон', [], 'historical'],
  ['x_magomet', 'Магомет', [], 'historical'],
  ['x_newton', 'Ньютон', [], 'historical'],
  ['x_schiller', 'Шиллер', [], 'historical'],
  ['x_lazarus', 'Лазарь', [], 'biblical'],
  ['x_raphael', 'Рафаэль', [], 'historical'],
  ['x_radishchev', 'Радищев', [], 'historical']
]

const characters = GOLD.map(([id, name, aliases]) => {
  const stats = mentionStatistics(text, [name, ...aliases], words)
  if (stats.mentionCount === 0) throw new Error(`gold ${id} has no mention in the text`)
  return {
    id,
    name,
    mentionCount: stats.mentionCount,
    significant: false,
    unnamed: false,
    firstMentionTextOffset: stats.firstMentionTextOffset,
    aliases
  }
})

const tier = significantTier(characters, 0.95)
for (const character of characters) character.significant = tier.ids.has(character.id)
characters.sort((left, right) =>
  right.mentionCount - left.mentionCount || left.id.localeCompare(right.id, 'en'))

const totalMentions = characters.reduce((sum, { mentionCount }) => sum + mentionCount, 0)
const chapterCount = (text.match(/^Глава [IVXL]+$/gm) ?? []).length

const fixture = {
  schemaVersion: 1,
  id: 'prestuplenie-i-nakazanie-ru-v1',
  goldCount: characters.length,
  significantCount: characters.filter(({ significant }) => significant).length,
  source: {
    dataset: 'narra-catalog-ru-web-gold',
    language: 'ru',
    title: 'Преступление и наказание',
    author: 'Фёдор Достоевский',
    bookEditionId: 'bef16434-1e57-4088-a9e0-aa3883797e1f',
    normalizedTextSha256: createHash('sha256').update(text).digest('hex'),
    textLength: text.length,
    chapterCount,
    rosterProtocol: 'roster taken from the reference pages listed in references[]; only entities those pages present as characters of this work are gold',
    mentionCountProtocol: `${MENTION_COUNT_RULE}: computed by evaluation/count-identity-mentions.mjs from the surfaces in name+aliases against the normalized text with the sha256 above — the NAME_ENDINGS word forms of the reader matcher applied to the whole surface, spans merged longest-first without overlap. Unlike the Verne and Onegin fixtures, whose counts were assembled by hand, every number here is regenerable from the text by one command and is pinned by test/book-analysis-character-cards-ru.test.mjs`,
    significantProtocol: 'minimum descending mention-count prefix covering at least 95 percent of gold mentions, including boundary-frequency ties, restricted to characters the text names with a proper noun; characters marked unnamed:true stay gold but are excluded from the gated tier',
    totalMentions,
    namedMentions: tier.namedMentions,
    significantBoundaryMentionCount: tier.boundaryMentionCount,
    references: [
      'https://ru.wikipedia.org/wiki/Преступление_и_наказание',
      'https://obrazovaka.ru/sochinenie/prestuplenie-i-nakazanie/glavnye-geroi-harakteristika.html',
      'https://www.literaturus.ru/2020/09/vse-geroi-prestuplenie-i-nakazanie-personazhi-spisok.html',
      'https://theocrat.ru/geroi-romana-prestuplenie-i-nakazanie.html'
    ],
    publishedRosterCap: 20,
    publishedRosterCapNote: 'book-markup-v3 публикует не более MAX_PUBLISHED_BOOK_CHARACTERS=20 персонажей (book-character-selection.mjs, character-frequency-v1). Полнота по всему gold ограничена этим потолком сверху; ярус significant этой книги тоже больше 20 не бывает.',
    homonymNote: 'Миколка — два разных лица: мужик из сна Раскольникова (111947..117536) и красильщик Николай Дементьев, который берёт вину на себя (с 685491). Ссылочные страницы называют так только красильщика, поэтому поверхность принадлежит ему; счёт упоминаний включает и сон.'
  },
  gates: {
    precision: 0.9,
    recall: 0.9,
    f1: 0.9,
    criticalMerges: 0,
    duplicateRate: 0.05
  },
  characters,
  knownExtras: KNOWN_EXTRAS.map(([id, name, aliases, kind]) => ({ id, name, aliases, kind })),
  collisionGuards: [
    {
      id: 'raskolnikov_surname',
      surfaces: ['Раскольников', 'Раскольникова', 'Раскольниковы'],
      goldIds: ['rodion_raskolnikov', 'pulcheria_raskolnikova', 'dunya_raskolnikova'],
      reason: 'фамилия Раскольников делится между Родионом, его матерью и сестрой; падежные формы мужского и женского рода в правиле NAME_ENDINGS неразличимы, поэтому поверхность принадлежит Родиону — так его называют ссылочные страницы'
    },
    {
      id: 'marmeladov_surname',
      surfaces: ['Мармеладов', 'Мармеладова', 'Мармеладовы'],
      goldIds: ['semyon_marmeladov', 'katerina_marmeladova', 'sonya_marmeladova'],
      reason: 'фамилия Мармеладов делится между Семёном Захаровичем, его женой и Соней'
    },
    {
      id: 'svidrigailov_surname',
      surfaces: ['Свидригайлов', 'Свидригайлова', 'Свидригайловы'],
      goldIds: ['arkady_svidrigailov', 'marfa_svidrigailova'],
      reason: 'фамилия Свидригайлов делится между Аркадием Ивановичем и Марфой Петровной'
    },
    {
      id: 'dmitry_given_name',
      surfaces: ['Дмитрий'],
      goldIds: ['dmitry_razumikhin', 'mitrey'],
      reason: 'имя Дмитрий носят Разумихин и красильщик Митрей, которого в показаниях называют Дмитрием; поверхность не отдана никому'
    },
    {
      id: 'ivanovna_patronymic',
      surfaces: ['Ивановна'],
      goldIds: ['alena_ivanovna', 'katerina_marmeladova', 'amalia_lippevekhzel', 'luiza_ivanovna'],
      reason: 'отчество Ивановна носят четыре разных женщины; без имени поверхность неразрешима'
    },
    {
      id: 'petrovich_patronymic',
      surfaces: ['Петрович'],
      goldIds: ['porfiry_petrovich', 'ilya_petrovich', 'pyotr_luzhin'],
      reason: 'отчество Петрович носят Порфирий, Илья и Лужин; без имени поверхность неразрешима'
    }
  ]
}

writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 2)}\n`)
console.log('goldCount', fixture.goldCount, 'significantCount', fixture.significantCount)
console.log('totalMentions', totalMentions, 'boundary', tier.boundaryMentionCount, 'chapters', chapterCount)
for (const c of characters) {
  console.log(String(c.mentionCount).padStart(5), c.significant ? 'SIG' : '   ', c.id.padEnd(24), '@' + c.firstMentionTextOffset)
}

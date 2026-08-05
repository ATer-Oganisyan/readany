/**
 * Базовый словарь ударений для синтеза речи SaluteSpeech (P9).
 *
 * Конвенция SaluteSpeech (проверена по документации): ударение обозначается
 * апострофом СРАЗУ ПОСЛЕ ударной гласной, работает только для русского языка.
 * Дока: https://developers.sber.ru/docs/ru/salutespeech/guides/synthesis/ssml/accents —
 * «после ударной буквы добавьте апостроф — '»; примеры из доки:
 * «за'мок» — ударение на «а», «замо'к» — ударение на «о».
 *
 * Данные лежат прямо в коде (единицы КБ). Структура расширяемая: элемент —
 * форма с ударением; `inflect: true` означает «имя, генерировать падежные
 * словоформы от основы» (см. stressedNameForms в stress-markup.ts; при
 * ударении в срезаемом окончании или короткой основе остаётся только точная
 * форма). Омографы, требующие контекста (за́мок/замо́к, до́рога/доро́га,
 * творо́г/тво́рог), сюда сознательно НЕ входят — без контекста разметка
 * сделает только хуже.
 */

export interface StressDictionaryEntry {
  /** Форма слова с апострофом сразу после ударной гласной. */
  stressed: string;
  /** Имя: генерировать падежные словоформы от основы (только при ударении в основе). */
  inflect?: boolean;
}

/**
 * Имена персонажей bundled-каталога (18 книг русской классики,
 * см. bundled-catalog-characters.ts) + несколько мировых имён.
 * Только имена с уверенно известным ударением; имена с «ё» (Гринёв,
 * Пугачёв, Ноздрёв) не нужны — «ё» синтезатор читает сам.
 */
const CHARACTER_NAME_ENTRIES: readonly StressDictionaryEntry[] = [
  // «Отцы и дети»
  { stressed: "база'ров", inflect: true },
  { stressed: "кирса'нов", inflect: true },
  { stressed: "одинцо'ва", inflect: true },
  { stressed: "фе'нечка", inflect: true },
  { stressed: "федо'сья", inflect: true },
  // «Анна Каренина»
  { stressed: "каре'нин", inflect: true },
  { stressed: "вро'нский", inflect: true },
  { stressed: "щерба'цкая", inflect: true },
  { stressed: "обло'нский", inflect: true },
  { stressed: "сти'ва", inflect: true },
  { stressed: "ки'ти", inflect: true },
  // «Война и мир»
  { stressed: "безу'хов", inflect: true },
  { stressed: "болко'нский", inflect: true },
  { stressed: "болко'нская", inflect: true },
  { stressed: "росто'в", inflect: true },
  // «Преступление и наказание»
  { stressed: "раско'льников", inflect: true },
  { stressed: "мармела'дова", inflect: true },
  { stressed: "разуми'хин", inflect: true },
  { stressed: "свидрига'йлов", inflect: true },
  { stressed: "порфи'рий", inflect: true },
  { stressed: "авдо'тья", inflect: true },
  // «Ревизор»
  { stressed: "хлестако'в", inflect: true },
  { stressed: "дмухано'вский", inflect: true },
  // «Мёртвые души»
  { stressed: "чи'чиков", inflect: true },
  { stressed: "мани'лов", inflect: true },
  { stressed: "коро'бочка", inflect: true },
  { stressed: "собаке'вич", inflect: true },
  { stressed: "плю'шкин", inflect: true },
  // «Герой нашего времени»
  { stressed: "печо'рин", inflect: true },
  { stressed: "грушни'цкий", inflect: true },
  { stressed: "бэ'ла", inflect: true },
  { stressed: "лиго'вская", inflect: true },
  // «Капитанская дочка»
  { stressed: "шва'брин", inflect: true },
  { stressed: "саве'льич", inflect: true },
  { stressed: "миро'нов", inflect: true },
  // «Евгений Онегин»
  { stressed: "оне'гин", inflect: true },
  { stressed: "ле'нский", inflect: true },
  { stressed: "ла'рина", inflect: true },
  // «Золотой ключик»
  { stressed: "бурати'но", inflect: true },
  { stressed: "мальви'на", inflect: true },
  { stressed: "пьеро'", inflect: true },
  { stressed: "караба'с", inflect: true },
  { stressed: "бараба'с", inflect: true },
  { stressed: "артемо'н", inflect: true },
  // «Двенадцать стульев»
  { stressed: "бе'ндер", inflect: true },
  { stressed: "воробья'нинов", inflect: true },
  { stressed: "оста'п", inflect: true },
  { stressed: "грицацу'ева", inflect: true },
  { stressed: "щу'кина", inflect: true },
  { stressed: "э'ллочка", inflect: true },
  // «Три сестры»
  { stressed: "прозо'ров", inflect: true },
  { stressed: "верши'нин", inflect: true },
  { stressed: "кулы'гина", inflect: true },
  // «Чайка»
  { stressed: "тре'плев", inflect: true },
  { stressed: "заре'чная", inflect: true },
  { stressed: "арка'дина", inflect: true },
  { stressed: "триго'рин", inflect: true },
  { stressed: "шамра'ева", inflect: true },
  // «Вишнёвый сад»
  { stressed: "ране'вская", inflect: true },
  { stressed: "лопа'хин", inflect: true },
  { stressed: "га'ев", inflect: true },
  { stressed: "трофи'мов", inflect: true },
  // «Гроза»
  { stressed: "каба'нов", inflect: true },
  { stressed: "кабани'ха", inflect: true },
  { stressed: "кудря'ш", inflect: true },
  // Популярные мировые имена (пользовательские книги)
  { stressed: "гермио'на", inflect: true },
  { stressed: "дра'ко", inflect: true },
  { stressed: "се'верус", inflect: true },
  { stressed: "ха'грид", inflect: true },
  { stressed: "уи'зли", inflect: true },
];

/**
 * Слова с фиксированным ударением, которые русские TTS стабильно портят.
 * Точные формы, без генерации словоформ.
 */
const COMMON_WORD_ENTRIES: readonly StressDictionaryEntry[] = [
  { stressed: "звони'т" },
  { stressed: "звоня'т" },
  { stressed: "звони'шь" },
  { stressed: "позвони'т" },
  { stressed: "позвони'шь" },
  { stressed: "катало'г" },
  { stressed: "катало'ги" },
  { stressed: "кварта'л" },
  { stressed: "кварта'ла" },
  { stressed: "догово'р" },
  { stressed: "догово'ра" },
  { stressed: "догово'ры" },
  { stressed: "жалюзи'" },
  { stressed: "щаве'ль" },
  { stressed: "то'рты" },
  { stressed: "то'ртов" },
  { stressed: "ба'нты" },
  { stressed: "ша'рфы" },
  { stressed: "краси'вее" },
  { stressed: "краси'вейший" },
  { stressed: "балова'ть" },
  { stressed: "балу'ет" },
  { stressed: "избало'ванный" },
  { stressed: "обеспе'чение" },
  { stressed: "обеспе'чения" },
  { stressed: "наме'рение" },
  { stressed: "наме'рения" },
  { stressed: "хода'тайство" },
  { stressed: "диспансе'р" },
  { stressed: "апостро'ф" },
  { stressed: "и'конопись" },
  { stressed: "зави'дно" },
  { stressed: "добы'ча" },
  { stressed: "облегчи'ть" },
  { stressed: "облегчи'т" },
  { stressed: "углуби'ть" },
  { stressed: "премирова'ть" },
  { stressed: "сре'дства" },
  { stressed: "парте'р" },
  { stressed: "фено'мен" },
  { stressed: "столя'р" },
  { stressed: "ку'хонный" },
  { stressed: "сли'вовый" },
  { stressed: "опто'вый" },
  { stressed: "экспе'рт" },
  { stressed: "украи'нский" },
  { stressed: "танцо'вщица" },
  { stressed: "досу'г" },
  { stressed: "коры'сть" },
  { stressed: "ломо'ть" },
  { stressed: "и'скра" },
  { stressed: "вероиспове'дание" },
];

export const BASE_STRESS_ENTRIES: readonly StressDictionaryEntry[] = [
  ...CHARACTER_NAME_ENTRIES,
  ...COMMON_WORD_ENTRIES,
];

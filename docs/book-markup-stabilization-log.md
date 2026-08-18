# Стабилизация разметки книг

Статус на 18 августа 2026 года. Этот файл — короткий рабочий журнал, а не новая архитектура.
Доказательная схема `personality` / `character_trait` / `appearance` остаётся без изменений.

## Исходное состояние

- Проверенный фактический `HEAD`: `2a31f71f`; переданный в задаче `742a1530` является его предком.
- Worktree до начала изменений был чистым.
- Pipeline: `book-analysis-v18`; scan: `book-scan-v10`; synthesis: `character-profile-v3`;
  результат: `book-markup-v3`.
- Фактический размер scan core: около 4 000 символов, overlap 500. Числа v17 в
  `book-analysis-v3.md` устарели.

## Что считаем приемлемым

1. Персонажи: one-to-one matching по именам, aliases и подтверждённым mentions; precision, recall и
   macro-F1 по книгам — не ниже 0.90. Duplicate и ошибочный merge штрафуются.
2. Description и personality: reference заранее раскладывается на атомарные утверждения. Два человека
   независимо отмечают semantic match / contradiction; целевой claim-F1 — не ниже 0.90,
   contradictions — не выше 0.02, корректность evidence — 1.00.
3. Personality обязателен для каждого значимого персонажа, для которого текст содержит достаточное
   evidence устойчивого поведения. Для эпизодической фигуры без таких сведений честное значение —
   `unknown`, а не выдуманная черта.
4. References никогда не передаются generation service и используются только после получения
   результата.

Один cosine similarity не используется как критерий 90%: он плохо выявляет отрицания и
противоречия. Его можно показывать только как вспомогательную диагностику.

## Набор 1 → 2 → 4

Точные URL, raw/canonical SHA-256 и размеры находятся в
`services/narra-gateway/evaluation/books.json`. Все четыре входа приводятся к UTF-8 TXT с удалёнными
Project Gutenberg header/footer, чтобы front matter и лицензия не создавали ложных персонажей.

1. `Pride and Prejudice` — открытая диагностическая книга: BOOKCOREF gold, LitBank, PDNC,
   OpenPsychometrics.
2. `Siddhartha` — добавляется как отдельная full-book проверка BOOKCOREF gold.
3. `Little Women` — добавляется на стадии 4 для проверки personality по LitBank и независимым
   crowd-профилям OpenPsychometrics.
4. `Alice's Adventures in Wonderland` — добавляется на стадии 4 для aliases и описательных имён по
   LitBank/PDNC.

Следующий языковой regression-набор: «Пиковая дама» и «Преступление и наказание». Открытого русского
full-novel gold сопоставимого с BOOKCOREF не найдено, поэтому reference для них нужно размечать
двум людям до запуска.

## Бесплатные источники проверки

- [BOOKCOREF](https://github.com/SapienzaNLP/bookcoref) — экспертный full-book coreference gold для
  трёх книг; использовать только human gold, не LLM-generated silver. Лицензия CC BY-NC-SA 4.0.
- [LitBank](https://github.com/dbamman/litbank) — ручная разметка персонажей на фрагментах 100 книг,
  CC BY 4.0.
- [PDNC](https://github.com/Priya22/project-dialogism-novel-corpus) — ручные full-book aliases и
  importance; явной лицензии в репозитории нет, поэтому только read-only benchmark.
- [OpenPsychometrics SWCPQ](https://openpsychometrics.org/tests/characters/data/) — миллионы
  человеческих оценок черт, CC BY-NC-SA 4.0; это weak supervision, не абсолютная истина.
- [BookWorm](https://github.com/apapoudakis/BookWorm) — внешние human-written descriptions;
  исходные тексты нельзя перераспространять, поэтому только ручная read-only сверка.

## Наблюдение до первой смены алгоритма

В `book-scan-v10` прямой `character_trait` создаётся только когда черта явно названа текстом.
`character-profile-v3` разрешает вывести устойчивую черту из двух `character_action` или
`character_dialogue`, но scan prompt не требует полно собирать поведенческие evidence и не говорит
явно привязывать однозначные местоимения к известному в локальном контексте имени. Это вероятная,
но пока не подтверждённая прогоном причина пустого personality.

## Журнал изменений

| № | Изменение | Почему | Результат | Решение |
|---:|---|---|---|---|
| 0 | Локальный Docker-контур, review UI, frozen 4-book inputs | Сделать результат наблюдаемым и повторяемым до правки prompt | Контур healthy; UI/sample HTTP 200; 346 тестов прошли, 7 opt-in integration пропущены | Оставить; не менять алгоритм до baseline |

Локальные контейнеры оставлены запущенными. Четыре канонических TXT повторно скачаны downloader'ом,
и их SHA-256, размеры и длины совпали с frozen manifest.

## Текущий блокер реального baseline

В локальном окружении не заданы `LLM_BASE_URL`/`LLM_API_KEY` или
`LITELLM_BASE_URL`/`LITELLM_API_KEY`; TEST operator также недоступен без авторизации. Поэтому прогоны
1 → 2 → 4 ещё не считаются выполненными. Sample/import режим review UI проверяет интерфейс, но не
качество LLM. Для продолжения нужен один OpenAI-compatible LLM route либо доступ только на чтение к
готовым TEST publications.

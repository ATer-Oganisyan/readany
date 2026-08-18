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
Project Gutenberg header/footer. Издательские предисловия и оглавления конкретного издания остаются
в тексте: это отдельный проверяемый случай, а не часть удаляемой лицензии Gutenberg.

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

## Журнал изменений

| № | Изменение | Почему | Результат | Решение |
|---:|---|---|---|---|
| 0 | Локальный Docker-контур, review UI, frozen 4-book inputs | Сделать результат наблюдаемым и повторяемым до правки prompt | Контур healthy; UI/sample HTTP 200; 346 тестов прошли, 7 opt-in integration пропущены | Оставить; не менять алгоритм до baseline |
| 1 | Baseline `book-scan-v10` + `character-profile-v3` на P&P | Зафиксировать исходную точку до изменения алгоритма | Identity P/R/F1 `60,71/89,47/72,34%`; description `5/10`; SWCPQ personality P/R/F1 `14,95/40,00/21,77%`; 3 ложных персонажа из предисловия | Baseline заморожен; исправлять front matter, description и traits независимо |
| 2 | `book-scan-v11` + `character-profile-v4`: section titles в prompt, более полный behavioral scan, обязательный description, 3–6 чистых traits, строгий alias prompt | Поднять заполненность description/personality и убрать meta-персонажей | Description `10/10`, загрязнение traits `10,3% → 1,6%`; personality F1 лишь `23,30%`, recall `30%`; identity F1 упал до `68,09%`, появились ошибочные aliases | Synthesis v4 и разделение traits оставить; alias-наставление откатить, prompt-фильтр front matter считать недостаточным |
| 3 | `book-scan-v12`: pure-paratext gate до LLM | Дать детерминированную гарантию вместо рекомендации модели | Все 8 чистых chunks предисловия пропущены, но run остановился на `181/182` из-за повторяемого HTTP 422; слишком широкая heading-regex ошибочно распознала prose `introduction at …` | Не принимать; сузить грамматику заголовков и локализовать повторяемый отказ одного chunk |
| 4 | `book-scan-v13` + `character-profile-v4`: строгие heading forms, pure-paratext gate, final-empty только для пяти повторных `EVIDENCE_MISMATCH`/`GENERATOR_HTTP_422` | Сохранить текстовые offsets, не потерять сюжетный пролог и не ронять всю книгу из-за одного content-level отказа | P&P завершён `182/182`; ложные front-matter персонажи `3 → 0`; identity P/R/F1 `65,31/84,21/73,56%`; personality P/R/F1 `21,82/30,00/25,26%`; description `9/10`; hard trait contamination `0%` | Текущий лучший стабильный вариант, но quality gate 90% не пройден; resolver и personality требуют отдельной следующей итерации |

## Результаты 1 → 2 → 4 на `book-scan-v13` / `character-profile-v4`

| Книга | Run / chunks / время | Characters | Identity reference | Description | Personality |
|---|---|---:|---|---:|---:|
| Pride and Prejudice | `9e2edbda`, `182/182`, 10,50 мин | 49 | BOOKCOREF: P/R/F1 `65,31/84,21/73,56%`; 16 дублей, false `0` | 42/49; 9/10 SWCPQ characters | 36/49; SWCPQ P/R/F1 `21,82/30,00/25,26%` |
| Siddhartha | `461f7a53`, `54/54`, 5,00 мин | 7 | BOOKCOREF: P/R/F1 `100/77,78/87,50%`; без лишних строк, но Young Siddhartha и Samanas ошибочно поглощены aliases | 3/7 | 6/7 |
| Alice's Adventures in Wonderland | `7d710d16`, `36/36`, 5,65 мин | 30 | PDNC full inventory: P/R/F1 `83,33/50,00/62,50%`; major+intermediate recall `10/11 = 90,91%`; 5 дублей, false `0` | 23/30 | 17/30 |
| Little Women | `d5f98f35`, `252/252`, 21,04 мин совместно с Alice | 86 | LitBank Chapter I: P/R/F1 `40,00/100/57,14%`; 6/6 найдены, но раздроблены на 15 rows; false `0` | 74/86; 6/6 target clusters | 49/86; frozen SWCPQ P/R/F1 `8,16/16,67/10,96%` |

Все четыре финальных run имеют `status=ready`, terminal job failures `0`. Повторные попытки были
локальными: P&P — 4 jobs, Siddhartha — 5, Little Women — 3, Alice — 0. Полный Gateway suite после
изменений: 355 passed, 0 failed, 7 opt-in integration skipped.

## Что подтверждено и что не прошло

- Детерминированный front-matter gate работает: `George Saintsbury`, `Miss Austen` и
  `Mrs. Musgrove` исчезли, начало Chapter I не потеряно.
- Synthesis v4 резко улучшил заполненность descriptions и убрал appearance/status/preferences из
  personality, не меняя `book-markup-v3` и доказательную схему.
- Общий порог 90% пока не достигнут. Главный identity-дефект P&P — 16 alias-дублей; у Siddhartha
  есть два ошибочных merge; у Alice полный PDNC denominator включает 39 minor/allusion entities,
  тогда как значимые персонажи уже проходят 90% recall. В Little Women все 6 персонажей
  официального LitBank-фрагмента найдены, но представлены 15 строками; на полном output после
  collapse остаются 59 top-level персонажей, 21 duplicate и 6 персонажей вложенных произведений.
- Personality остаётся слабым: на P&P найдено только 12/40 frozen crowd-полюсов. Есть внутренняя
  контрадикция Wickham: trait `principled` при description `deeply lacking in principle`. Blind
  Little Women подтвердил проблему: 4/24 frozen crowd-полюсов, micro-F1 `10,96%`, все 6 target
  персонажей фрагментированы по aliases, у Amy две прямые пары противоречащих traits.
- Честный description semantic F1 не вычислялся: SWCPQ не содержит prose gold, а BookWorm нельзя
  перераспространять. Сейчас зафиксированы coverage и evidence checks; 90% semantic F1 требует
  отдельного human atomic gold с двумя ревьюерами.

Следующая итерация должна быть узкой: whole-book identity reconciliation с collision guards для
родственников/одноимённых персонажей и contradiction check для synthesized traits. Расширять
first-name/surname fuzzy merge без такого guard нельзя: v11 уже ошибочно объединил Jane и Elizabeth.

Локальные контейнеры оставлены запущенными. Для реальных прогонов использован уже настроенный
task-relevant OpenAI-compatible route без вывода или сохранения ключа в репозитории. Четыре
канонических TXT повторно проверены по frozen SHA-256. TEST и production не изменялись.

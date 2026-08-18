# Стабилизация разметки книг

Статус на 18 августа 2026 года. Этот файл — короткий рабочий журнал, а не новая архитектура.
Доказательная схема `personality` / `character_trait` / `appearance` остаётся без изменений.

## Исходное состояние

- На текущем продолжении проверен `HEAD` `bede6d3935bbb3e5b5dbf4937f070212364400c5`;
  переданный в задаче `742a1530` устарел. Worktree уже содержал несвязанные backend/mobile
  изменения; они сохранены, коммитов в рамках исследования нет.
- Текущий research-код: pipeline `book-analysis-v32`, scan `book-scan-v14`, synthesis
  `character-profile-v10`, identity `character-identity-v11`; внешний результат по-прежнему
  `book-markup-v3`.
- Активные локальные workers намеренно не перезапускались и остаются на прежних образах. Все v28–v31
  показатели ниже получены одноразовыми `--read-only` containers на замороженных observations либо
  детерминированным повторным фильтром сохранённого результата.
- Фактический размер scan core: около 4 000 символов, overlap 500. Числа v17 в
  `book-analysis-v3.md` устарели.

## Что считаем приемлемым

1. Значимые персонажи: one-to-one matching по именам, aliases и подтверждённым mentions; precision,
   recall и F1 **на каждой книге** — не ниже 0.90. Critical merge — 0, duplicate rate — не выше
   0.05. Significant denominator фиксируется по source-only правилу до просмотра нового output:
   corpus importance, либо минимальный BOOKCOREF-набор с 95% mentions, либо все индивидуальные
   именованные персонажи официального LitBank-фрагмента.
2. Description: reference заранее раскладывается на атомарные утверждения. Factual precision по
   cited evidence и coverage значимых персонажей — не ниже 0.80. Semantic recall/F1 станет gate,
   только когда появится исчерпывающий human prose gold; текущие внешние источники его не дают.
3. Personality: factual precision по cited evidence — не ниже 0.90; coverage персонажей с
   достаточным evidence — не ниже 0.80; contradictions, category contamination и temporal/polarity
   defects — каждый не выше 0.02. `unknown` считается пропуском, но предпочтительнее выдуманной
   черты. SWCPQ и human evidence audit отчётятся раздельно: crowd top-4 не является исчерпывающей
   текстовой истиной и не используется как release gate.
4. Personality обязателен для каждого значимого персонажа, для которого текст содержит достаточное
   evidence устойчивого поведения. Для эпизодической фигуры без таких сведений честное значение —
   `unknown`, а не выдуманная черта.
5. References никогда не передаются generation service и используются только после получения
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
  трёх книг; использовать только human gold, не LLM-generated silver. License metadata в
  источниках расходится, поэтому до legal review — только локальный read-only benchmark.
- [LitBank](https://github.com/dbamman/litbank) — ручная разметка персонажей на фрагментах 100 книг,
  CC BY 4.0.
- [PDNC](https://github.com/Priya22/project-dialogism-novel-corpus) — ручные full-book aliases и
  importance; явной лицензии в репозитории нет, поэтому только read-only benchmark.
- [OpenPsychometrics SWCPQ](https://openpsychometrics.org/tests/characters/data/) — миллионы
  человеческих оценок черт, CC BY-NC-ND 4.0 по codebook; это research-only weak supervision,
  не абсолютная истина и не distributable product fixture без legal review.
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
| 5 | `book-analysis-v19`, `book-scan-v14`, `character-profile-v5`: evidence-grounded aliases, compact traits 0–4, scene/polarity/antonym filter | Убрать ошибочные aliases, заполнение personality ради количества и прямые контрадикции | P&P significant identity P/R/F1 `54,84/94,44/69,39%`; full F1 `72,09%`; 14 дублей и 2 critical merge. Trait factual precision `89,47%`, direct contradictions `0%`, но frozen SWCPQ R/F1 `17,50/17,95%`; description coverage `8/10` | Частично оставить: Wickham polarity исправлена и compactness выросла. Не принимать как quality improvement: identity precision и personality recall провалены; локального chunk-level prompt недостаточно |
| 6 | `book-analysis-v20`, `character-profile-v6`: collision guards + bounded whole-book identity reconciliation внутри существующего resolve-job; дополнительные factual trait guards | Сначала запретить destructive merge однофамильцев/тёзок, затем объединять только существующие entity keys с evidence по полному roster | P&P scan `182/182`; модель увидела 72 provisional characters, но вернула `0` merge. Confirmed synthesis rows сократились `49 → 39`, однако provisional graph выявил новый destructive bridge `Bingley → Mr./Miss Bingley` | Не принимать: слишком строгий discovery-prompt дал полное abstention, а overlap guard применялся не ко всем alias proof paths |
| 7 | `book-analysis-v21`, `character-identity-v2`: hard-negative для ambiguous structural overlap на любом union; модель классифицирует не весь декартов roster, а до 128 детерминированных пар-кандидатов | Дать глобальному проходу решаемую bounded-задачу и одновременно исключить общий surname/title bridge | P&P: 2 корректных model merge из 127 пар, но significant identity P/R/F1 только `57,69/83,33/68,18%`, duplicate rate `30,95%`, 1 critical merge. Personality factual precision `92,31%`, frozen R/F1 `10,00/12,12%`; description coverage `8/10` | Не принимать: общий F1 ниже v19; guard ошибочно понизил сильно подтверждённых `Mr./Mrs. Bennet` до candidate, а prompt объединил только 2 из 13 дублей |
| 8 | `book-analysis-v22`, `character-identity-v3`: ambiguity запрещает unsafe union, но не демотирует устойчивую титулованную сущность; `Lady Catherine` учитывается как конкурент bare `Catherine`; prompt явно разрешает единственную совместимую полную форму по whole-book roster | Восстановить recall центральных персонажей, убрать Catherine/Kitty merge и повысить collapse безопасных вариантов имени без fuzzy-правил | P&P significant P/R/F1 `64,29/100/78,26%`, 11 дублей; Lady Catherine/Kitty исправлены, но модель ошибочно объединила `Mr Darcy ↔ Georgiana Darcy`. Personality после ручного разделения: factual P `88,57%`, frozen R/F1 `20,00/21,33%` | Не принимать: recall восстановлен, но precision/dup-rate не прошли и новый sibling merge делает publication невалидной |
| 9 | `book-analysis-v23`, `character-identity-v4`: sibling-family guard; strong unique given/full-name и точный titled-prefix merge; lifecycle-evidence получает приоритет, prompt отдельно требует явный married-name transition | Убрать unsafe `Mr Darcy/Georgiana`, детерминированно схлопнуть воспроизводимые дубли и дать модели факты о смене фамилии вместо случайной цитаты | Целевой suite `91/91` прошёл. P&P significant identity P/R/F1 `65,38/94,44/77,27%`; 9 дублей, critical merge `2`, dup-rate `21,43%`. Darcy/Georgiana исправлены, но вернулся Lady Catherine/Kitty и появился Mrs/Mr Hurst. Personality factual P `89,66%`, frozen R/F1 `12,50/14,49%`; description coverage впервые `10/10` | Не принимать: end-to-end результат нестабилен и все identity gates, кроме recall, провалены. Не запускать следующую книгу до отделения resolver-итераций от вариативности повторного scan |
| 10 | Зафиксировать observation set успешного v22 и повторять только resolve/reconciliation в read-only evaluation harness | Между v22 и v23 менялся не только resolver: одинаковый `book-scan-v14` был заново вызван на 182 chunks и дал другой provisional roster. Это смешивает качество алгоритма со случайностью LLM и делает сравнение итераций недостоверным | Harness читает snapshot в `REPEATABLE READ READ ONLY`, сверяет run/hash, не пишет в БД; scorer автоматически считает TP/FN/DUP/MERGE и gates. Targeted tests `10/10` | Оставить как evaluation-only инструмент; принимать resolver-правку только по delta на одном observation set, полный scan→publish повторять после локального gate |
| 11 | `book-analysis-v24`, `character-identity-v5`: proof-based given/full/title joins, explicit signed-name и spouse/lifecycle bridges; component-level gender guard; single-letter initial не считается honorific | Схлопнуть только доказанные aliases и запретить модели объединять супругов/родственников. `M. Gardiner` перепроверен по тексту: это подпись Mrs Gardiner, не сокращение Mr Gardiner | На неизменных `1 982` observations v22, без generation: significant P/R/F1 `94,74/100/97,30%`; critical merge `0`; dup-rate `2,50%`; strict gate **PASS**. Full BOOKCOREF P/R/F1 `85,00/89,47/87,18%`: отсутствуют 4 эпизодические сущности, которых нет даже среди resolver candidates | Детерминированный resolver принять как первый прошедший identity-gate для значимых персонажей. Перед книгой №2 нужен один полный E2E P&P; внешний локальный LiteLLM route оказался plaintext HTTP, поэтому generation/новый scan не запускать до безопасного HTTPS route |
| 12 | `book-analysis-v25`, `character-identity-v6`: owner-scoped reification для доказанных `X's son/father`; точный kinship label создаётся только когда quote содержит owner и possessive relation; generational label не участвует в обычном given/full-name merge | На Siddhartha collision guards безопасно разделили героя, сына и отца, но оставили сына/отца как FN. Нужно было поднять recall без глобального alias `young Siddhartha`, `boy`, `Brahman` или `Samana` | Первый frozen replay: significant P/R/F1 `85,71/75,00/80,00%`, FAIL. После одной правки на тех же `586` observations: `100/100/100%`, critical merge `0`, duplicates `0`, **PASS**. Full BOOKCOREF: P/R/F1 `100/88,89/94,12%`; единственный FN — non-significant collective `The Samanas` | Принять для стадии 2 и переходить к frozen стадии 4. Full recall ниже 90% явно отчётить; не материализовывать коллективную роль только ради метрики |
| 13 | Frozen gold fixtures для Alice/PDNC и Little Women/LitBank; scorer нормализует только заранее разрешённый артикль и проверяет collision guards | Расширить проверку с 2 до 4 книг без ручного post-hoc matching | Alice significant P/R/F1 `90,91/90,91/90,91%`, PASS; full recall `50%`, потому что scanner не извлёк 25 minor/allusion identities. Первое сравнение Little Women было невалидно: full-book output ошибочно сравнивался с Chapter I gold | Сохранять scope вместе с метрикой; full и significant denominators не смешивать |
| 14 | `character-profile-v8`: evidence-only fallback description; неизвестный gender всегда получает нейтральный voice `Erm`; отдельные personality scorer и replay | Заполнить обязательные UI-поля без выдумывания описания и устранить неопределённый пол TTS | P&P v28: traits/description/UI/voice coverage `100/100/100/100%`, contradictions `0`. Независимый blind evidence audit: traits `28/31 = 90,32%`; hard rejects — `conceited`, skill `accomplished`, эпизодическое `anxious`. Description atoms `40/48 = 83,33%`, coverage `10/10`. SWCPQ P/R/F1 `32,26/25,00/28,17%` | Evidence-gates traits и description проходят, но contamination выше лимита. SWCPQ хранить отдельным crowd-similarity сигналом, не оптимизировать prompt под его top-4 labels |
| 15 | Operator JSON view: quality summary, profile cards и raw JSON; evaluation CLI умеет immutable fixture scoring и offset scope | Сделать результат наблюдаемым и не допускать ложного сравнения разных фрагментов | UI assets и API tests проходят; v28 replay не пишет в БД. Offset scope запрещён вместе с generation и сохраняет original snapshot hash + source/scoped counts | Оставить evaluation-only; перед публикацией v28 нужен отдельный coordinated E2E run |
| 16 | `book-analysis-v28`, `character-identity-v8`: owner-scoped sibling labels; grounded two-person relationship label безопасно материализуется как две character entities | В LitBank Chapter I scanner сохранил `Father and Mother` только как relationship, из-за чего обе человеческие gold-сущности были FN | На exact LitBank scope `[1737,10454)` roster `6`, P/R/F1 `100/100/100%`, merge/duplicate `0`, PASS. Все четыре significant identity gates проходят; полный suite `435 passed`, `0 failed`, `7 skipped` | Research target по значимым персонажам достигнут на 4 книгах. Не утверждать 100% по всем minor identities и не выкатывать v28 без нового full E2E |
| 17 | `book-analysis-v29`, `character-identity-v9`: имя с артиклем подтверждается только при немедленной capitalized head (`the Caterpillar`), но не для описательной фразы (`the oldest one of the Samanas`) | Alice имела 20 grounded Caterpillar observations, но entity оставалась candidate; первая широкая правка создала false positive в Siddhartha | Alice significant P/R/F1 `91,67/100/95,65%`, Siddhartha снова `100/100/100%`; все 4 significant gates PASS, critical merges `0` | Принять как финальный frozen research candidate; full E2E и русский blind set остаются обязательными |
| 18 | `character-profile-v9`: минимум confidence `0,80`; skills/achievements запрещены; anxious-like emotion допускается только из прямого устойчивого `character_trait`; description prompt требует связный текст и cited entailment каждого атома | Blind audit v8 нашёл ровно три воспроизводимых дефекта: неподтверждённый low-confidence trait, skill вместо personality и вывод устойчивой тревожности из эпизодических состояний | Детерминированный re-filter того же P&P output: `31 → 28` traits; все оставшиеся `28/28` прошли прежний blind evidence audit, coverage `10/10`, category/temporal defects `0`. SWCPQ diagnostic: TP `10 → 9`, P/R/F1 `32,14/22,50/26,47%`. Новый description prompt без provider E2E пока не измерен | Guards принять: factual quality выросла без потери coverage. Не считать prompt-эффект description доказанным до безопасного HTTPS provider run; SWCPQ-падение явно сохранить как trade-off |
| 19 | Stress-test v9 filter на сохранённых v13/v4 outputs ещё трёх книг, без нового provider-вызова | Проверить, можно ли безопасно ослабить scene/category guards ради semantic recall до нового synthesis | Siddhartha `22 → 13`, Little Women `143 → 86`, Alice `48 → 25` traits. LW SWCPQ TP/predictions `4/49 → 3/35`, F1 `10,96 → 10,17%`. Ослабление scene gap возвращает вместе с валидными traits category errors; ослабление temporal guard возвращает вместе с `modest/careful` эпизодические `looked humble/cheerful/friendly face` | Не ослаблять filter по старым v4 outputs: он не может исправить отсутствующую semantic entailment. Следующее измерение — только новый v9 synthesis на тех же frozen evidence; старые цифры использовать как stress-test, не как качество v9 |
| 20 | `book-analysis-v30`, `character-identity-v10`: dominant-evidence given/full-name join; self-declared first name with shared family bridge; explicit spouse surname transition; triangulated family nickname | Full-book Little Women roster разделял `Beth/Beth March`, `Jo/Jo March/Jo Bhaer`, `Laurie/Theodore Laurence` и `Marmee/Mrs. March`, из-за чего personality harness честно отказывался выбирать 4 ambiguous gold characters | Все четыре lifecycle/alias группы схлопнуты в one-to-one confirmed IDs на неизменных `3299` observations. Frozen identity gates P&P/Siddhartha/Alice/LitBank Chapter I остались PASS, significant recall `100%`, critical merge `0` | Принять в research candidate: каждое новое правило имеет positive и hard-negative tests; gold labels в resolver не передавались |
| 21 | `book-analysis-v31`, `character-profile-v10`: direct trait считается устойчивым только при lexical support в quote; `wore off`/`no longer` и аналоги делают evidence временным | Новый provider replay Little Women выявил нестабильный `bashful` (`soon wore off`) и неподтверждённый direct label `gentle`; широкое ослабление ухудшает factual precision | V31 вернул 13 traits для 6/6 characters; single-review cited-evidence audit `13/13`, coverage traits/description/UI/voice `100%`, contradictions `0`. SWCPQ P/R/F1 `15,38/8,33/10,81%`, FAIL | Factual gate на второй книге пройден; crowd top-4 semantic gate не пройден. Не подмешивать SWCPQ answer key в prompt |
| 22 | `book-analysis-v32`, `character-identity-v11`: relationship observation принадлежит только relationship entity; участники связываются с уже независимо подтверждёнными character entities, но не получают тот же evidence ID | Dorian Gray v31 завершил scan `108/108`, затем пять раз падал в resolve: цитата `Lord Henry Wotton and Lord Fermor` одновременно назначалась relationship и двум character entities, нарушая repository invariant `one evidence → one entity` | Read-only replay тех же `1262` observations и тех же трёх frozen identity merges: v31 имел 4 invariant violations, v32 — `0`; targeted resolver/repository/reconciliation suite `77/77` PASS | Принять общее исправление и повторить Dorian новым versioned run; не ослаблять repository invariant |

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

## Последний четырёхкнижный frozen итог `book-analysis-v31`

| Книга и scope | Gold | P / R / F1 significant | Full P / R / F1 | Merge / duplicate | Gate |
|---|---|---:|---:|---:|---:|
| Pride and Prejudice, full book, `1982` observations | BOOKCOREF, `18` significant / `38` full | `94,74 / 100 / 97,30%` | `85,00 / 89,47 / 87,18%` | `0 / 1` | PASS |
| Siddhartha, full book, `586` observations | BOOKCOREF, `8 / 9` | `100 / 100 / 100%` | `100 / 88,89 / 94,12%` | `0 / 0` | PASS |
| Alice, full book, `518` observations | PDNC, `11 / 50` | `91,67 / 100 / 95,65%` | `96,30 / 52,00 / 67,53%` | `0 / 0` | PASS |
| Little Women, exact LitBank Chapter I `[1737,10454)`, `34/3299` observations | LitBank, `6 / 6` | `100 / 100 / 100%` | `100 / 100 / 100%` | `0 / 0` | PASS |

Pride and Prejudice personality после детерминированного `character-profile-v10` re-filter
сохранённого v28 output (10 frozen characters, 27 traits):

- cited-evidence factual precision: `27/27 = 100%` по неизменному blind evidence audit;
- trait, description, UI core и voice/gender coverage: `100%`; contradiction rate: `0`;
- category и temporal contamination: `0`; удалены `conceited`, `accomplished`, `anxious`;
- strict SWCPQ micro P/R/F1: `33,33/22,50/26,87%`, diagnostic FAIL. Этот crowd top-4 список слабый и
  неисчерпывающий; factual claims вроде `Wickham → unprincipled` он может штрафовать как extra.
- description v8: atomic cited-evidence precision `40/48 = 83,33%`, coverage `10/10`, что проходит
  согласованный порог 80%. Эффект нового v9 description prompt ещё не проверен provider-run.
- remaining risk: `conceited` сейчас отсечён self-reported confidence, а category/emotion guards
  используют конечные списки. Они не заменяют semantic entailment каждой citation; paraphrase
  может обойти guard. Поэтому `27/27` — результат данного frozen output, не общая гарантия.

Little Women personality после нового `character-profile-v10` provider replay
(6 frozen characters, 13 traits):

- cited-evidence factual precision: `13/13 = 100%` по single-review evidence audit;
- trait, description, UI core и voice/gender coverage: `100%`; contradiction rate: `0`;
- strict SWCPQ micro P/R/F1: `15,38/8,33/10,81%`, diagnostic FAIL;
- разница не сводится к ложным чертам: output возвращает доказуемые `impetuous`,
  `inquisitive`, `selfless`, `principled`, `generous`, а crowd gold ожидает другие top-4 оси. Это
  не даёт основания объявить 80% semantic personality до human adjudication.

## Что подтверждено и что ещё не прошло

- Цель `100% распознавание персонажей` достигнута как recall значимых персонажей на всех четырёх
  frozen scopes. Нельзя переносить это утверждение на всех эпизодических персонажей: full recall
  P&P `89,47%`, Siddhartha `88,89%`, Alice `52%`.
- Personality cited-evidence gates пройдены на двух книгах: P&P `27/27`, Little Women
  `13/13`, coverage `100%`, contradictions/category/temporal defects `0`. Для P&P это
  re-filter сохранённого output, для Little Women — новый provider replay. Оба аудита пока
  выполнены одним reviewer; для acceptance нужны второй blind reviewer и adjudication.
- Строгая crowd-SWCPQ similarity на обеих книгах далека от 80%. Этот целевой порог
  **не достигнут**; подгонять prompt под заранее известные top-4 labels нельзя.
- Согласованный description-порог 80% на первой книге пройден (`83,33%`, coverage `100%`). Более
  жёсткий 90% порог пока не пройден; semantic completeness нельзя честно измерить без human prose
  gold. Extractive fallback безопасен по ссылкам, но его текст иногда стилистически шероховат.
- Русского full-novel human gold сопоставимого с BOOKCOREF не найдено. Следующий blind regression —
  заранее размеченные двумя людьми «Пиковая дама» и «Преступление и наказание»; до разметки нельзя
  настраивать алгоритм по их output.
- Alexandria используется как MIT architecture/reference, autiobook — только как GPL-3.0
  architecture reference, BookNLP/BOOKCOREF — как English baseline. Код этих библиотек в продукт
  не включался, и текущие цифры не являются результатом запуска Alexandria или BookNLP.

Локальный review-контур остаётся на `127.0.0.1:18787`, MinIO — `19000/19001`; основной gateway
`8787`, TEST и production не изменялись. v31 пока существует как пересобранный research-image и
read-only replay artifacts в `/private/tmp`; перед выкладкой нужен coordinated full
scan → resolve → synthesize → validate → publish на отдельной копии данных. Ключи LLM не
выводились и не сохранялись в репозитории. Финальный gateway suite: `445 passed`, `0 failed`,
`7 skipped`.

# Готовность к нагрузке: 1000 DAU

## Дополнительная независимая HTTP-проверка

На commit `172ade2` оба CI workflow завершились успешно (Gateway run
33968189762, Regression run 33968189769). Затем добавлен
`test/workload-concurrency-http.test.mjs`, отдельно проверенный root на Node24:
настоящий процесс gateway, installation-регистрация и HTTP, отдельная временная
папка данных, локальный управляемый upstream, без внешнего AI/БД.

22 фоновых запроса заняли 10 активных мест и 12 мест ожидания; следующий
фоновый запрос получил 429. Одновременно приняты диалог с персонажем через
stream и Narra через complete; максимум upstream — 12. Некорректные тела на
обоих маршрутах вернули 400 без изменения очереди. После отмены всех запросов
active/waiting и открытые upstream-соединения вернулись к нулю.

Это проверка публичных HTTP-маршрутов и их подключения к scheduler, не прогон
внутренних generation routes с PostgreSQL, не замер производительности модели
и не многочасовая нагрузка. Локальные файлы теста автоматически удаляются;
пользовательские данные не участвуют.

Дата: 2026-09-05. Исходный аудит выполнялся на базе `667ae9b`; последующее исправление описано ниже. Это план приёмки и изолированные доказательства, **не результат нагрузочного теста production**. В ходе первоначального аудита runtime не менялся; затем добавлено резервирование LLM-очереди. Внешние AI/TEST/prod не вызывались, общие БД не использовались.

## Что действительно проверено

На Node 24 выполнено **19 PASS, 0 FAIL, 0 SKIP**:

```sh
env -u DATABASE_URL -u BOOK_MARKUP_TEST_DATABASE_URL \
  PATH=/private/tmp/node-v24.20.0-darwin-arm64/bin:$PATH node --test \
  services/narra-gateway/test/concurrency.test.mjs \
  services/narra-gateway/test/book-upload-admission.test.mjs \
  services/narra-gateway/test/generation-queue-control.test.mjs \
  services/narra-gateway/test/image-timeouts.test.mjs
```

Поведенческие проверки: реальная очередь ограничивает active/waiting, abort удаляет ожидающего; реальный Express upload handler не читает body до допуска, освобождает слот после ошибки/отключения, ограничивает зависший upload дедлайном, не публикует отменённую загрузку; реальный локальный byte journal учитывает размер. Остальные проверки — конфигурация таймаутов, speech cap и парсер операторских команд; это не нагрузка на провайдера и не проверка реального SQL locking.

Существующий `test/postgres-release-concurrency.integration.test.mjs` проверяет 192 вызова одного scene slot, fairness книг, 32 независимых запроса / 8 владельцев с квотой 12, 64 конкурирующих claims и fencing старой lease. Здесь НЕ запускался: требует `BOOK_MARKUP_TEST_DATABASE_URL`, выполняет миграции и записи. Для повторения использовать только отдельную одноразовую БД. Это полезные инварианты, но не доказательство пропускной способности на 1000 DAU. Полноценного arrival-rate/soak harness среди просмотренных load/queue/concurrency файлов не найдено.

## Фактические пределы по умолчанию

Источник: `services/narra-gateway/index.mjs:185–242`, `concurrency.mjs`, `compose.i167.yml`. Это defaults кода, не измеренные настройки запущенного production.

| Ресурс | Активные / очередь | Другие пределы |
|---|---:|---|
| LLM | 12 / 16 | Общий gate для internal generation и публичного чата; публичная AI-квота 25 000/сутки |
| Speech | 5 / 16 | 5 — также верхний допустимый env cap; публичная квота 50 000/сутки |
| Import | 2 / 2 | 50 MiB/книга, 1000 импортов и 10 000 MiB/сутки глобально |
| Image | 4 / 12 | 5000/сутки публичная квота |
| Cover | 2 / 8 | 3000/сутки публичная квота |

Это process-local gates: две gateway replicas не создают автоматически общий распределённый cap. Квоты публичных API нельзя автоматически приписывать внутренним генерациям. Регистрация по умолчанию ограничена 250/сутки глобально: 1000 DAU существующей базы и одновременный запуск для 1000 новых пользователей — разные сценарии.

Compose задаёт по одной replica markup, identity, TTS markup, analysis scan/synthesis, media, scene workers. Scan/stage runners ожидают `runOnce()` в цикле; их request timeout по умолчанию 300 секунд. Увеличивать replicas без измерения общего провайдерского лимита нельзя.

## P1: фоновые запросы вытесняют живой диалог

`index.mjs:665` — `completeInternalChat()` получает `llmGate`; передан в `createInternalGenerationService` около строки 1200. В `internal-generation-service.mjs` через него выполняются scan/profile/recall/audit. Публичные `/v2/ai/chat/stream` и `/v2/ai/chat/complete` около строк 1784/1899 получают **тот же gate**. FIFO не различает классы запросов и не резервирует место в очереди для клиента.

На реальном gate воспроизведено: 12 active + 16 queued фоновых работ → следующий интерактивный запрос отклонён `429/RATE`. При неполной очереди чат стоит после ранее поставленной фоновой работы. Это доказательство поведения при насыщении, **не утверждение, что одна текущая scan replica сама создаёт 28 одновременных запросов**. Пользовательский burst и увеличение workers делают риск существенным.

Воспроизводимый model-free probe из корня:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createConcurrencyGate } from './services/narra-gateway/concurrency.mjs';
const gate = createConcurrencyGate({limit:12, queueLimit:16, name:'llm'});
const active = await Promise.all(Array.from({length:12}, () => gate.acquire()));
const controllers = Array.from({length:16}, () => new AbortController());
const queued = controllers.map(c => gate.acquire(c.signal).then(r => r(), () => {}));
assert.equal(gate.status().waiting,16);
await assert.rejects(gate.acquire(), e => e.status === 429 && e.code === 'RATE');
controllers.forEach(c => c.abort()); await Promise.all(queued);
active.forEach(release => release());
assert.equal(gate.status().active,0); assert.equal(gate.status().waiting,0);
console.log('PASS: saturation rejects interactive admission; cleanup complete');
JS
```

## Явная модель 1000 DAU

Это стартовые assumptions для согласования с аналитикой, а не сведения о реальных клиентах.

| Поток | Суточная модель | Час пик / burst |
|---|---|---|
| Чтение | 1000 человек × 2 сессии × 15 минут | 20% сессий в час пик = 100 средних одновременных читателей; тестировать 200 |
| Импорт | 100 книг/сутки, средняя 5 MiB | 30/час = 1 каждые 120 секунд; отдельный burst 10 одновременно |
| Диалог | 300 человек × 10 сообщений = 3000/сутки | 600/час = 1 каждые 6 секунд; burst 40 сообщений |
| Озвучка | 100 человек × 20 минут = 2000 минут аудио | 20% в пик = 400 минут/час, около 6.7 слушателей; burst 20 стартов |
| Сцены | 200 человек × 3 запроса = 600/сутки | 120/час = 1 каждые 30 секунд; burst 20 разных сцен + 64 повтора одной |

Для TTS отдельно принять размер чанка 30 секунд аудио: 4000 запросов/сутки, 800/час в пик до cache hits, retries и prefetch. Это assumption: снять фактические длительности/размеры чанков перед прогнозом стоимости. 5 upstream streams — не 5 слушателей: пропускная способность зависит от времени синтеза и попаданий в кеш.

Для LLM при средней длительности запроса 10/30/60 секунд 12 слотов дают теоретический потолок 72/24/12 запросов в минуту до retries и служебных расходов. Чат в модельном пике требует 10/мин, оставляя очень разный бюджет фону. Чанкирование по умолчанию 4000 символов (2500–5000, контекст 500): книга в миллион символов даёт примерно 250 scan chunks. Если 100 новых уникальных книг этого размера требуют полного scan, это около 25 000 scan calls/сутки **до** профилей/аудитов/повторов. Реальные counts снять отдельно для текущего pipeline; общий публичный AI quota не является доказанным бюджетом внутренних вызовов.

## Воспроизводимая кампания нагрузки

Полный HTTP load runner и fake-provider ещё нужно добавить; ниже спецификация, не утверждение о готовой команде или выполненном прогоне.

1. Создать отдельные disposable PostgreSQL и object storage, отдельные volumes, gateway data directory, 1000 seeded installation identities. Зафиксировать SHA, CPU/RAM, replicas, env limits и seed. Запретить egress, кроме loopback/docker test network. Не использовать `.env` TEST/prod и настоящие ключи. Запустить существующие PostgreSQL integration tests только с URL этой БД.
2. Поднять локальный OpenAI-compatible stub: complete JSON, SSE, задержки 10/30/60 секунд, 429/502, malformed JSON, зависание и обрыв. `providers.mjs` поддерживает `LLM_BASE_URL`/`LITELLM_BASE_URL`; настроить **все включённые provider/fallback URL** на stub и dummy keys. Для speech/image, где безопасный URL override не подтверждён, использовать внедряемый transport в изолированном harness; до этого не запускать их HTTP route с настоящей конфигурацией.
3. Корпус с фиксированными SHA: 20 собственных валидных книг RU/EN EPUB/FB2/TXT/PDF, FBZ нормализовать клиентским путём; размеры 0.1/5/20/49 MiB. Дополнительно повреждённый ZIP/XML, превышение 50 MiB, повтор одинаковых байтов и повтор книги с изменёнными байтами. Не путать загрузку server source и работу нативного picker/URL: последние — отдельная UI-приёмка.
4. HTTP runner с фиксированным seed и **open arrival rate**, не только замкнутыми VU: resolve/register/source upload → content/TOC/chunks → manifest/character preview → chat stream/complete → scene create/poll. Брать payload и exact routes из actual `book-catalog-api.mjs` и API tests, сохранять edition/hash/ownership каждого клиента. Для каждого чтения сохранять/восстанавливать прогресс клиентским harness; не считать server HTTP достаточной проверкой UI.
5. 10 минут прогрев, 30 минут модельного пика, 30 минут ×2, отдельные bursts из таблицы, затем 2 часа soak. Повторить cold/warm cache. На 15-й минуте: 10% отменённых upload/LLM/TTS, 5% provider 502, 5% hangs, один worker restart/lease expiry. После прекращения arrivals измерить время дренирования backlog.
6. Записать по классам p50/p95/p99 queue wait, first token/byte, duration, admission rejection, errors, cache hits, retry amplification; gate active/waiting, oldest job age, worker leases, DB pool wait/locks, CPU/RSS/event-loop lag, object bytes, token/audio cost. Разделять ожидаемые 429 в overload и необъяснимые отказы в штатном пике.

### Критерии прохождения (целевые, пока не измерены)

- Штатный пик: 0 потерянных/чужих книг, 0 дублированных job/квот, 0 завершений отменённой клиентом публикации; unexpected 5xx <0.1%, ожидаемая рабочая нагрузка не получает quota/admission отказов.
- Интерактивная очередь p95 ≤1 секунды; first token и first audio измерять раздельно от provider latency, бюджет согласовать после реального canary. С медленным stub не объявлять провайдерский UX быстрым.
- Локальное чтение при AI saturation: p95 отклик листания ≤100 мс; чтение/закладки/возврат сохраняются. Проверяется отдельно на физических iOS/Android, не выводится из серверного RPS.
- Отмена удаляет queued работу немедленно; активная upstream работа освобождает слот после подтверждённого завершения/abort, без превышения лимита. Протечки active/waiting после drain — 0.
- При ×2/burst: bounded queue, явный retryable busy, без неограниченных retries/OOM; после снятия нагрузки восстановление без рестарта. При nominal 2h очередь не имеет устойчивого роста; RSS после GC не показывает линейной утечки.
- Для персонажей: отдельно first usable preview и full ready по размеру книги; release budget нельзя обещать до измерения новой версии pipeline. CPU-only stub не подтверждает качество реальной разметки/голосов.

## Первоначальное предложение ограниченной правки: резерв LLM

На момент исходного аудита не реализовано; реализация ниже описана отдельно. Изменить только admission helper, три callsites и tests; не менять provider cap и очередь БД.

- Общий жёсткий `active <= 12`; два класса `interactive/background`. Hard reserve 2 для interactive и 1 для background: background active ≤10, interactive active ≤11. Это сознательно оставляет часть слотов пустыми при одноклассовой нагрузке, зато не требует небезопасной preemption активных запросов и гарантирует доступность резерва. Work-conserving lending резерва не добавлять в первую версию: долгий выданный background request иначе вновь блокирует клиента.
- Общий waiting ≤16, зарезервировать 4 queue entries для interactive и 1 для background: background waiting ≤12, interactive waiting ≤15, плюс общий cap. FIFO внутри класса, round-robin между допустимыми головами очередей, пропуск временно заблокированного класса. Это предотвращает starvation background при непрерывном потоке чата. Временная гарантия зависит от ограниченного срока каждой активной работы, не только round-robin.
- `completeInternalChat` всегда background. В обеих публичных chat routes сначала валидировать `parseChatBody`, затем классифицировать allowlisted диалоговые purposes; не считать весь `/complete` фоном и весь `/stream` диалогом. Не доверять произвольному client origin как праву на резерв; существующие пользовательские quotas оставить. Точный allowlist сверить с контрактом парсера и frontend Narra/character callers в реализации.
- `acquire(signal)` старого generic gate и status fields сохранить для import/speech/image/cover. Новый LLM helper использовать явно, с default reservation 2/1 для лимита 12; при limit <3 — документированный FIFO fallback без ложной гарантии обоих резервов. Недопустимые overrides валидировать, не превышать total. Feature flag позволяет возврат к старому FIFO, но release acceptance проходить с включённой защитой.
- Abort ожидающего удаляет именно его запись; abort активного **не** освобождает счётчик до `finally` завершившегося provider consumer. Release идемпотентен. Добавить отдельный bounded admission timeout с отменой waiter; не использовать Promise.race, оставляющий «призрачный» запрос в очереди. `requestAbortSignal` публичных routes и internal signal сохранить сквозными.
- Actual-gate tests: 10 background + очередь не мешают двум interactive; бесконечная подача interactive не лишает background зарезервированного слота; общий cap ни разу не превышен; queue reservation переживает полный чужой класс; FIFO по классу; cancellation перед/после handoff; double release; deadline; invalid config; limit 1/2; обе public route формы с fake provider и actual gate; slow response body удерживает слот до конца. Повторить смешанный HTTP soak после unit/integration PASS.

## Выполненная ограниченная правка после аудита

Добавлен `workload-concurrency.mjs`, generic gate остальных ресурсов не изменён. LLM сохраняет общий cap12/queue16; резервы active 2/1, waiting 4/1. FIFO внутри класса и round-robin допустимых голов очереди. При total1 резервы автоматически 0, при total2 — 1/1; queue0 поддерживается helper. Недопустимые числовые значения/суммы резервов отвергаются при запуске. Четыре optional env override описаны в `.env.example`.

Все три callsites подключены: internal — background; публичные complete/stream сначала выполняют `parseChatBody`, затем `assistant` и `character_chat` получают interactive, остальные валидные purposes — background. Поле origin не даёт привилегий. Старые поля status сохранены, добавлены per-workload counters/caps. Отмена queued удаляет запись; после handoff счётчик освобождает только идемпотентный release вызывающей стороны, а не сам abort.

RED доказан на старом actual gate: резервный тест получил 12 фоновых active вместо10. После реализации actual-gate tests проверяют насыщение, прогресс фона, FIFO/fairness, отмену до/после dispatch, double release, переполнение/невалидные настройки, малые лимиты, классификацию actual parser и burst100. Отдельный admission timeout и полноценный HTTP route/soak harness в этой правке **не добавлены**; существующие сквозные сигналы отмены сохранены. Резервы гарантируют место, но не SLA скорости модели и не распределённый cap нескольких gateway replicas.

**Вывод:** безопасность admission импорта и резервы LLM подтверждены ограниченными поведенческими тестами. Заявлять готовность к 1000 DAU пока нельзя: отсутствуют измерения mixed workload/soak и производительности реальных моделей. Исходный saturation probe выше намеренно остаётся воспроизведением старого generic gate; новый LLM helper проверяется отдельным `test/workload-concurrency.test.mjs`.

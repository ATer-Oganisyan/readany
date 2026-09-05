## Основное

Стабилизация core loop **импорт → чтение → контекстное взаимодействие →
возврат к сохранённому месту** в `mishanaer/Narra`.

- **Импорт:** проверка настоящего содержимого, надёжное сохранение, безопасный
  повтор/новая редакция/repair; FB2/TXT кодировки, архивы, URL timeout/Cancel,
  честные результаты смешанной загрузки. Собственные форматы открыты на iOS/Android.
- **Чтение:** зависания и пропуск глав, WebView request races, EPUB Range,
  PDF/CBZ rendering/позиции, checkpoint, book-scoped заметки и возврат без
  накопления Reader; управление, тема, контраст и лишние фоновые renders.
- **Персонажи и чат:** ошибки анализа не скрываются как пустой успех,
  русские identity/kinship проверки, восстановление UI, точный контекст
  страницы в character prompt, ограничение полного complete-response.
- **TTS:** старт с видимого остатка предложения; поведенческие регрессии
  и проверка реального Android DOM без сдвига позиции. Отмена незавершённой
  подготовки, включая общий Stop, видимый Preparing/Cancel и защита от старого EOF.
- **Закладки:** подтверждение только после БД, точный якорь и подпись,
  список/переход/удаление, Android header/Close; atomic tombstone+DELETE.
- **FBZ → AI:** проверенный XML извлекается без подмены идентичности архива;
  cache восстанавливается при потере, повторный импорт не использует старый binding.
- **Сцены/backend:** terminal failure отделён от явного retry, bounded inline
  polling/download, SQL idempotency/quota; admission до буферизации upload,
  ZIP64 safety, backend dependencies/container и CI с PG/S3.

## Проверки и границы

- Последний локальный mobile: **165 suites / 1 475 PASS**, TypeScript PASS.
- Последний core: **84 suites / 675 PASS**. Предыдущий полный backend: **807 PASS**, с реальными
  локальными PostgreSQL/MinIO. GitHub CI оценивается отдельно по checks PR.
- Native iOS/Android сценарии и точные ограничения записаны в отчётах.
- TEST при последней проверке — **HTTP 502**. Live AI quality/latency, новый
  TTS на iOS, signed release/физические устройства и production capacity
  **не приняты**. Это stabilization PR, не утверждение «готово к массовому релизу».
- Последняя TTS-правка новее ранее проверенных production Hermes exports.
- Новый TrackPlayer recovery patch установлен через lockfile: Kotlin harness
  9 PASS, полный Android module compile и debug APK build PASS. APK обновлена
  на QA AVD без очистки данных; приёмка звука/lifecycle ещё идёт.
  Первичный Fabric SIGSEGV этим patch не объявлен устранённым.
- Новая APK сохранила QA-книгу и точный CFI; фактический TTS loading начинается
  с видимого текста. Cancel/звук пока не приняты: provider501/502 мешал проверке,
  длительный белый экран dev cold start завершился без повторного перезапуска;
  точная позиция сохранилась, Cancel gate продолжается.

## Отчёт и следующий результат

[Шесть клиентских сценариев: сделано, препятствия backend, образ 10/10 и план](https://github.com/mishanaer/Narra/blob/codex/core-loop-audit-20260904/docs/reviews/core-product-loop-report-2026-09-05.md).

Приоритет: сквозная отмена/сохранность → единые контекст и readiness →
foreground AI без ожидания полной разметки → качество ролей/TTS/сцен →
полная native/live и нагрузочная приёмка.

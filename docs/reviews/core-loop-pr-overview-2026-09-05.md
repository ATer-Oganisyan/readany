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
  и проверка реального Android DOM без сдвига позиции.
- **Сцены/backend:** terminal failure отделён от явного retry, bounded inline
  polling/download, SQL idempotency/quota; admission до буферизации upload,
  ZIP64 safety, backend dependencies/container и CI с PG/S3.

## Проверки и границы

- Последний локальный mobile: **156 suites / 1 408 PASS**, TypeScript PASS.
- Предыдущие полные core/backend: **656 / 807 PASS**, backend с реальными
  локальными PostgreSQL/MinIO. GitHub CI оценивается отдельно по checks PR.
- Native iOS/Android сценарии и точные ограничения записаны в отчётах.
- TEST при последней проверке — **HTTP 502**. Live AI quality/latency, новый
  TTS на iOS, signed release/физические устройства и production capacity
  **не приняты**. Это stabilization PR, не утверждение «готово к массовому релизу».
- Последняя TTS-правка новее ранее проверенных production Hermes exports.

## Отчёт и следующий результат

[Шесть клиентских сценариев: сделано, препятствия backend, образ 10/10 и план](https://github.com/mishanaer/Narra/blob/codex/core-loop-audit-20260904/docs/reviews/core-product-loop-report-2026-09-05.md).

Приоритет: сквозная отмена/сохранность → единые контекст и readiness →
foreground AI без ожидания полной разметки → качество ролей/TTS/сцен →
полная native/live и нагрузочная приёмка.

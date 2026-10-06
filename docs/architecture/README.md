---
type: architecture-index
status: current
scope: Narra monorepo
last-reviewed: 2026-10-06
---

# Архитектура Narra

Это каноническая точка входа в описание фактической архитектуры ветки `main`.
Narra — local-first читалка на базе ReadAny, дополненная серверной разметкой
книг, персонажами, чатами, синтезом речи и генерацией медиа.

## Карта документов

- [Текущее состояние](./current-state.md) — контекст системы, контейнеры,
  границы данных, развёртывание, основные потоки и известные разрывы.
- [Клиенты и reader runtime](./components/client-and-reader.md) — desktop,
  Expo/React Native, WebView/Foliate и уровень Narra поверх ReadAny.
- [Разметка книг и TTS](./components/book-enrichment.md) — ingest, canonical
  markup v3, альтернативный analyzer, публикация, вторичная TTS-разметка.
- [AI, чаты и RAG](./components/ai-and-retrieval.md) — контекст чата с
  персонажем, контекст Нары и два независимых поисковых индекса.
- [Генерация медиа](./components/media-generation.md) — обложки, портреты и
  три разных контура сцен с API-контрактами.

## Предлагаемые изменения

- [Повторный импорт личных книг: спецификация и план приёмки](./target-state.md) — согласованное поведение, контракт, выключатели, транзакции и локальные iOS E2E.

## Решения

- [ADR-0001: явный повторный импорт private-книги](./decisions/0001-private-book-explicit-reimport.md) — owner-scoped идемпотентность, временная отсечка и edition-scoped source keys.

## Источники истины

Документы описывают код `main` на дату `last-reviewed`. При расхождении
приоритет имеют исполняемые контракты, миграции и тесты. Операционное состояние
конкретного стенда этими документами не подтверждается.

- Актуальный runbook: [Narra gateway deployment](../../services/narra-gateway/DEPLOYMENT.md).
- Языковые категории каталога: [book catalog language contract](../book-catalog-language-contract.md).
- Закрытый контур событий: [Narra product analytics](../narra-analytics.md).
- Контракт внешнего analyzer: [autiobook adapter](../../services/autiobook-adapter/README.md)
  и его [OpenAPI](../../services/autiobook-adapter/openapi.yaml).
- Точечные post-publication исправления: [character correction overlay](../book-character-correction-overlay.md).
- Формулы оценки пропускной способности: [book analysis throughput](../book-analysis-throughput-formulas.md).
- Снимки проверок не являются архитектурой, но сохраняют evidence:
  [core product loop review](../reviews/core-product-loop-architecture-2026-09-05.md).

## Архив документации

Прежние документы, которые называют устаревшие версии текущими, описывают
неисполненные планы или прежний deployment, перенесены в
[docs/deprecated](../deprecated/README.md). Исторические датированные отчёты в
`docs/*-migration-YYYY-MM-DD` и `docs/reviews` оставлены на месте как evidence,
но не являются источником текущей архитектуры.

## Правило обновления

Изменение границы контейнера, внешнего API, схемы хранения, запуска фоновой
работы или состава AI-контекста должно обновлять соответствующий component doc
и `current-state.md`. Новое предполагаемое состояние оформляется отдельно как
proposal/ADR и не смешивается с документами со статусом `current`.

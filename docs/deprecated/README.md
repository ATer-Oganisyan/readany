# Архив устаревшей документации

Эти файлы сохранены для истории, но не описывают текущее состояние `main`.
Каноническая архитектура находится в [`docs/architecture`](../architecture/README.md).

| Документ | Причина архивации | Замена |
| --- | --- | --- |
| [book-markup-architecture-v18.md](./book-markup-architecture-v18.md) | прежние pipeline/profile versions названы текущими | [Разметка и TTS](../architecture/components/book-enrichment.md) |
| [book-analysis-dual-pipeline.md](./book-analysis-dual-pipeline.md) | прежние versions; статус ветки устарел | [Разметка и TTS](../architecture/components/book-enrichment.md) |
| [book-analysis-v3.md](./book-analysis-v3.md) | ранняя историческая v3 specification | [Разметка и TTS](../architecture/components/book-enrichment.md) |
| [book-markup-backend.md](./book-markup-backend.md) | transitional bundle/contract stages | [Разметка и TTS](../architecture/components/book-enrichment.md) |
| [TTS_FOLIATE_NATIVE_MIGRATION.md](./TTS_FOLIATE_NATIVE_MIGRATION.md) | неисполненный branch plan | [Разметка и TTS](../architecture/components/book-enrichment.md) |
| [book-search-rag-implementation-plan.md](./book-search-rag-implementation-plan.md) | реализация уже в main; документ остался планом ветки | [AI и RAG](../architecture/components/ai-and-retrieval.md) |
| [catalog-top100-scene-generation-design.md](./catalog-top100-scene-generation-design.md) | proposed auto-prefetch противоречит текущему on-demand policy | [Генерация медиа](../architecture/components/media-generation.md) |
| [narra-infrastructure.md](./narra-infrastructure.md) | прежний host inventory/deploy commands | [Gateway deployment](../../services/narra-gateway/DEPLOYMENT.md) |
| [mobile-catalog-content-contract.md](./mobile-catalog-content-contract.md) | привязан к старому TEST backend build | [Текущее состояние](../architecture/current-state.md) |
| [ios-catalog-backend-api-changes.md](./ios-catalog-backend-api-changes.md) | snapshot ветки/TestFlight 43, не текущий contract | [Клиенты и reader](../architecture/components/client-and-reader.md) |
| [native-expo-reader-migration-plan.md](./native-expo-reader-migration-plan.md) | target без WebView/Foliate не реализован | [Клиенты и reader](../architecture/components/client-and-reader.md) |

Датированные migration evidence и review snapshots оставлены в исходных
папках: их статус уже следует из имени и содержания, а ссылки из тестов должны
оставаться стабильными.

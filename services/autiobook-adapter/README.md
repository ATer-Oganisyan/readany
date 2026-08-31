# Narra external autiobook adapter

Изолированная обёртка над `khimaros/autiobook` commit
`d532bdd0a15f2948fd0c99f5e11b92677cb5c3eb`. В публичном контракте стратегия
называется `external`; имя библиотеки остаётся только во внутреннем API.

Адаптер принимает canonical normalized text и возвращает только
`character_dialogue` / `character_alias` с точной цитатой и UTF-16 offsets.
Gateway повторно проверяет `source.slice(startOffset, endOffset) === quote`.

```http
POST /internal/v1/analyze
Authorization: Bearer <AUTIOBOOK_ADAPTER_TOKEN>
```

Контейнер не публикует host ports, запускается не от root с read-only root
filesystem и использует `/work` для cache/resume. Cache namespace включает
`external`, implementation version, pinned upstream, content hash,
`normalized-text-v1` и schema v3. Исходный текст и credentials не логируются.

Локальная проверка:

```bash
python3 -m unittest -v services/autiobook-adapter/test_adapter_core.py
```

Upstream лицензирован под GPL-3.0. При распространении собранного image нужно
соблюсти требования GPL-3.0 к исходному коду и уведомлениям.

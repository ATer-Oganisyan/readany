# Серверный образ: runtime, зависимости и проверка запуска

Локальная приёмка, не deployment и не нагрузочный sign-off. Проверен gateway
рабочей ветки `codex/core-loop-audit-20260904`; образ собран на Linux ARM64.

## Исправления и воспроизведение

- Node 20 заменён на поддерживаемый Node 24: Dockerfile, engines, npm lock,
  gateway CI и соответствующие checkout/setup-node actions согласованы.
  Использован официальный Node 24.20.0; базовый Alpine 3.23 image закреплён digest.
  Другие несвязанные workflow автоматически не обновлялись.
- fflate 0.8.2 → 0.8.3. Четыре крошечных ZIP64 (<2 KB) воспроизвели зависание
  **настоящих** извлечений текста/обложки: отсутствующее либо неправильное
  обязательное extra field. Дочерний процесс ограничен 96 MiB и двумя секундами;
  до исправления требовался SIGKILL, после те же вызовы завершаются за 24–37 ms
  в локальном контрольном прогоне. Четыре обычных ZIP32/ZIP64 EPUB остаются рабочими.
  Причина и исправление подтверждены
  [upstream commit](https://github.com/101arrowz/fflate/commit/e6d5e6e1076892f72770ac732d83c81da9f3316e)
  и [релизом 0.8.3](https://github.com/101arrowz/fflate/releases/tag/v0.8.3).
- qs 6.15.3 → 6.16.0 через точечный gateway npm override: текущие Express 4 и
  body-parser 1 ограничивают зависимость `~6.15.1`. Четыре RED→GREEN теста разрешают
  реальный пакет через обоих потребителей: не падает сериализация недоверенного
  `constructor.isBuffer`, соблюдается лимит bracket/comma arrays.
  Это проверка зависимостей, **не утверждение**, что gateway публикует все
  необязательные настройки из
  [advisory сериализации](https://github.com/ljharb/qs/security/advisories/GHSA-4mjr-xmp4-gh2g)
  и [advisory лимитов](https://github.com/ljharb/qs/security/advisories/GHSA-x5fp-wj9c-mxmx).

`npm ci --omit=dev --ignore-scripts` выполнен официальным Node 24.20.0 и bundled
npm. Lockfile diff ограничен этими двумя пакетами и engines. Production audit:
до — четыре moderate-записи (включая родителей qs), после — ноль известных
advisories среди 166 установленных зависимостей. Это не доказательство отсутствия
неизвестных уязвимостей.

## Проверки

| Проверка | Результат |
| --- | --- |
| Полный Node 24 gateway suite с настоящими PostgreSQL 17 и MinIO | 807 PASS, 0 FAIL, 0 SKIP |
| Linux ARM64 Docker build | PASS, `narra-gateway:qa-20260905-node24` |
| Production-mode startup с отдельными локальными тестовыми секретами и новым volume | PASS, user `node`, UID 1000 |
| `/health` и Docker HEALTHCHECK | HTTP 200, `healthy`, local registry storage verified |
| `/ready` без провайдеров | HTTP 503 ожидаемо: LLM/speech/image не настроены |
| Реальная PDF extraction внутри образа через Poppler | 12 sections, 32 679 символов, контрольный текст совпал |
| ffmpeg | 8.0.1 запускается и создаёт короткий синтетический WAV |
| ZIP64 + qs regressions внутри Linux image | 12/12 PASS |

Image digest:
`sha256:ce1d714cb16621cf00bd0241a485f7904a0477075c71359aad700a7c1159ddd9`.
Node 24.20.0, Poppler 25.12.0. Base digest фиксирован, но `apk add` получает
пакеты текущего Alpine repository: весь filesystem не заявляется побитово
воспроизводимым. В контейнер не передавались реальные provider/cloud secrets.
Контейнер не имел доступа к пользовательскому home или SSH agent.

Для проверки установлены Colima/Docker CLI/Buildx; отдельная VM `narra-qa`
получила 2 CPU, 2 GiB RAM, без home mounts, SSH forwarding и смены default Docker
context. Контейнер и VM остановлены 01:31:54; image и изолированный тестовый volume
оставлены для воспроизведения. Удалений пользовательских данных не было.

## Доказательства и границы

Логи: `/private/tmp/narra-audit-backend-node24-patched.log`,
`narra-audit-npm-ci-node24.log`, `narra-audit-gateway-image-build.log`,
`narra-audit-container-regressions.log`, `narra-audit-container-health.json`,
`narra-audit-container-ready.json`, `narra-audit-colima-stop.log`.
Тесты: `services/narra-gateway/test/book-source-zip64-safety.test.mjs` и
`query-parser-availability.test.mjs`.

PostgreSQL/S3 end-to-end tests выполнялись на хосте под Node 24; контейнерный
smoke не подключался к ним и не подтверждает production topology. Настоящие
AI-запросы, capacity для тысяч пользователей, signed mobile release и remote
CI/deploy этим этапом не проверены. Live TEST gateway остаётся отдельным blocker.

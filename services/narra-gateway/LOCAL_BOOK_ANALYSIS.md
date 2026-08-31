# Локальный стенд разметки v18

Стенд запускает только контур разметки: PostgreSQL, MinIO, Gateway и стадии
`prepare → scan → resolve → synthesize → validate → publish`. Генерация обложек,
портретов, TTS, idle-анимаций и мобильное приложение в него не входят.

## Просмотр готового примера без LLM

```bash
docker compose -f compose.book-analysis-local.yml up -d --build
```

Откройте `http://localhost:18787/operator/review`, логин `narra`, пароль
`narra-local-review-only`, затем нажмите «Открыть пример». Можно также открыть
любой JSON `book-markup-v3`; файл остаётся в браузере.

## Реальный анализ книги

1. Скопируйте `book-analysis-local.env.example` в `book-analysis-local.env`.
2. Укажите доступный OpenAI-compatible LiteLLM или Giga route и его API key.
3. Запустите стенд с окружением:

```bash
docker compose --env-file book-analysis-local.env \
  -f compose.book-analysis-local.yml up -d --build \
  --scale book-analysis-scan=3 \
  --scale book-analysis-synthesize=2
```

4. Откройте `http://localhost:18787/operator/`, загрузите EPUB, FB2, TXT или PDF
   и дождитесь стадии `publish`. Кнопка «Проверить разметку» откроет профиль и
   все использованные цитаты evidence.

Секрет LLM не попадает в image или git: Compose читает его только из локального
env-файла. Без рабочего LLM route стенд и sample review доступны, но реальные
jobs закономерно остановятся на `scan`.

## Диагностика и остановка

```bash
docker compose -f compose.book-analysis-local.yml ps
docker compose -f compose.book-analysis-local.yml logs -f gateway book-analysis-scan
docker compose -f compose.book-analysis-local.yml down
```

Данные сохраняются в именованных Docker volumes. Удалять их для обычного
перезапуска не нужно.

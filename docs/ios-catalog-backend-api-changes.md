# Изменения Backend/API для каталога iOS

Ветка: `codex/testflight-43-ui-polish`
Репозиторий: `Narra2`
Срез: перед TestFlight build 43

## Короткий вывод

Эта ветка **не меняет код серверного backend**: в diff нет серверных route’ов, миграций базы или изменений object storage. Она меняет iOS-клиент так, чтобы каталог книг и файлы книг приходили из существующего Narra Gateway API.

Новый пользовательский сценарий:

1. Приложение запрашивает список книг с backend.
2. Сохраняет метаданные каталога локально.
3. Скачивает обложки только для видимых карточек.
4. При выборе книги запрашивает подписанную ссылку на EPUB, скачивает файл и проверяет его SHA-256.
5. Импортирует книгу в локальную библиотеку, а обложку сохраняет локально.

Результат — EPUB и обложки больше не должны попадать в iOS-бандл заранее. Но сервер теперь обязан отдавать корректный каталог, ссылки на скачивание, размеры файлов и хэши.

## Что фактически изменилось

| Область | Изменение |
|---|---|
| Серверный backend | В этой ветке не изменён |
| Клиентский API-слой | Добавлены запросы каталога и подписанных ссылок на файлы |
| Каталог книг | Вместо встроенного списка используется backend-каталог |
| Обложки | Ленивая загрузка для видимых карточек, локальный кэш |
| EPUB | Скачивается только по нажатию на книгу, затем импортируется локально |
| Надёжность загрузки | До 3 попыток, новая подписанная ссылка на каждую попытку, timeout и отмена |
| Встроенные ассеты | Списки EPUB, обложек и персонажей очищены из runtime-каталога |
| Gateway URL | Ветка переключает Gateway на `api-test` для всех профилей сборки |

## Контракт API, который ожидает приложение

### 1. Получение каталога

Запрос:

```http
GET /v2/books/catalog?limit=100
Authorization: Bearer <installation-token>
```

Приложение ожидает JSON такого вида:

```json
{
  "items": [
    {
      "resolution": "catalog",
      "book_edition_id": "book-1",
      "catalog_key": "seagull",
      "title": "Чайка",
      "author": "Антон Чехов",
      "format": "epub",
      "content_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "source_download_path": "/v2/books/book-1/source/download",
      "cover": {
        "content_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "mime_type": "image/jpeg",
        "byte_size": 123456,
        "download_path": "/v2/books/book-1/cover/download"
      }
    }
  ]
}
```

Обязательные поля записи:

- `resolution` должен быть равен `catalog`;
- `book_edition_id`, `catalog_key`, `title`, `format` — строки;
- `content_sha256` — SHA-256 EPUB-файла в виде 64 hex-символов;
- `source_download_path` — путь внутри Gateway, начинающийся с `/v2/books/`.

Обложка необязательна. Если она есть, приложение проверяет `content_hash`, `mime_type`, положительный целый `byte_size` и `download_path`, также начинающийся с `/v2/books/`.

Особенности текущего клиента:

- запрашивается максимум 100 книг;
- пагинации и обработки `next_cursor` в этой ветке нет;
- отдельная некорректная запись пропускается без ошибки;
- если весь верхнеуровневый payload не содержит массива `items`, показывается ошибка каталога.

### 2. Получение подписанной ссылки

Для EPUB и обложки приложение делает GET по пути, который пришёл в каталоге:

```http
GET /v2/books/book-1/source/download
Authorization: Bearer <installation-token>
```

Ожидаемый ответ:

```json
{
  "download_url": "https://object-storage.example/signed-url..."
}
```

Затем файл скачивается уже по `download_url` через foreground `NSURLSession`/Expo `DownloadTask`. Новая ссылка запрашивается перед каждой повторной попыткой.

### 3. Авторизация

Каталог использует существующую installation-аутентификацию Gateway:

- идентификатор установки и секрет хранятся в SecureStore;
- приложение получает installation token через `/v2/installations/register` или `/v2/installations/refresh`;
- запросы каталога и ссылок идут с `Authorization: Bearer ...`;
- просроченный token обновляется автоматически;
- ошибки `401/403` преобразуются в ошибки авторизации приложения.

В самой ветке auth-протокол не переписан; добавлена новая нагрузка на него — запросы каталога и файлов.

## Как теперь проходит загрузка книги

```text
Gateway API
    │
    ├─ GET /v2/books/catalog?limit=100
    │       └─ метаданные + пути source/cover
    │
    ├─ GET /v2/books/.../cover/download
    │       └─ подписанная ссылка ──> локальный кэш обложки
    │
    └─ GET /v2/books/.../source/download
            └─ подписанная ссылка ──> EPUB ──> SHA-256 ──> импорт в библиотеку
```

### Открытие каталога

1. Сначала читается локальный `catalog.json`, чтобы пользователь сразу увидел ранее загруженный список.
2. Затем выполняется свежий запрос к backend.
3. При ошибке сети старый кэш остаётся рабочим.
4. Если кэша нет, показывается ошибка и кнопка повторной загрузки.

### Загрузка обложек

- обложки не скачиваются все сразу;
- в очередь попадают видимые карточки и небольшой диапазон вокруг viewport;
- одновременно выполняются максимум 2 загрузки;
- повторная постановка одной книги в очередь не создаёт второй запрос;
- при уходе со страницы активные загрузки отменяются;
- ошибка обложки не должна блокировать импорт EPUB — карточка останется с fallback-обложкой.

### Импорт EPUB

- исходный файл временно сохраняется в кэше приложения;
- перед импортом старый временный файл удаляется;
- после скачивания проверяется SHA-256;
- файл передаётся существующему локальному `importBooks`;
- после импорта временный файл удаляется;
- обложка, если она успела загрузиться, копируется в app data и привязывается к книге.

## Повторные попытки, timeout и отмена

Для каждого файла используется общий загрузчик `downloadVerifiedBackendFile`:

- максимум 3 попытки;
- перед каждой попыткой заново запрашивается `download_url`;
- timeout одной нативной попытки — 135 секунд;
- исходный файл проверяется по SHA-256;
- обложка дополнительно проверяется по размеру `byte_size`;
- после ошибки временный файл удаляется;
- отменённая загрузка не повторяется автоматически;
- новая выбранная книга может отменить зависшую загрузку предыдущей.

Для этого в общий `IPlatformService.downloadFile` добавлены `AbortSignal` и `timeoutMs`. В Expo вместо прежнего legacy downloader используется foreground `DownloadTask` с освобождением нативного task после завершения.

## Локальное хранение

| Данные | Где хранятся | Назначение |
|---|---|---|
| Метаданные каталога | `documentDirectory/narra-backend-catalog/catalog.json` | Показ каталога без сети |
| Обложки каталога | `documentDirectory/narra-backend-catalog/covers/` | Повторное использование обложек |
| Временный EPUB | `cacheDirectory/narra-catalog-import/` | Передача в локальный импорт |
| Финальная обложка книги | app data `covers/` | Отображение в библиотеке после импорта |

Кэш каталога имеет версию `1`. Обложка считается пригодной, если файл существует, не является директорией и совпадает с ожидаемым `byte_size`.

## Что отключено из встроенного каталога

Ветка делает пустыми compatibility-поверхности старого bundled-каталога:

- список встроенных книг больше не содержит книг;
- встроенные EPUB и обложки не подключаются через Metro;
- встроенные определения персонажей удалены из runtime;
- встроенная карта портретов персонажей очищена;
- `CatalogCharacterPortraitPreloader` больше не монтируется в `App`.

Это уже не просто API-интеграция. В diff нет отдельного нового client-side API-адаптера для персонажей и портретов. Поэтому перед объединением нужно отдельно подтвердить, откуда теперь берутся данные персонажей для книг из backend и какой для этого существует контракт. Иначе каталог может открываться, но экран персонажей потеряет старую встроенную fallback-данные.

## Переключение на `api-test`

Ветка меняет не только каталог, а базовый URL всего Narra Gateway:

| Конфигурация | Значение в ветке |
|---|---|
| `packages/app-expo/.env.development` | `https://api-test.narra.disrupt.builders` |
| `packages/app-expo/eas.json` — development | `api-test` |
| `packages/app-expo/eas.json` — development-simulator | `api-test` |
| `packages/app-expo/eas.json` — preview | `api-test` |
| `packages/app-expo/eas.json` — production | `api-test` |
| `packages/app-expo/eas.json` — production-apk | `api-test` |
| корневой `eas.json` — development/preview/production | `api-test` |
| fallback в `narra-gateway-fetch.ts` | `api-test` |

Это означает: **любой запрос, который проходит через `narraGatewayRequest`, будет отправляться на `api-test` в этих сборках**. В том числе запросы чата Narra/персонажей (`/v2/ai/chat/complete`, `/v2/ai/chat/stream`), генерации изображений, синтез речи и телеметрия. Это не ограничено только каталогом.

Запросы, которые не используют Narra Gateway, этой настройкой автоматически не переключаются.

### Риск для production

В текущем diff production-профили тоже направлены на `api-test`. Если это нужно только для тестовой сборки, перед merge production-профили следует вернуть на:

```text
https://api.narra.disrupt.builders
```

Если цель — временно тестировать весь iOS-клиент на тестовом backend, текущая настройка соответствует этой цели, но production-сборку нельзя считать production-конфигурацией.

## Основные файлы

| Файл | Роль |
|---|---|
| `packages/app-expo/src/lib/narra/backend-catalog-api.ts` | Разбор ответа каталога и получение `download_url` |
| `packages/app-expo/src/lib/narra/backend-catalog-cache.ts` | Кэш каталога и обложек |
| `packages/app-expo/src/lib/narra/backend-catalog-source.ts` | Временная загрузка EPUB |
| `packages/app-expo/src/lib/narra/backend-file-download.ts` | Retry, timeout, отмена и проверка файла |
| `packages/app-expo/src/lib/narra/backend-file-hash.ts` | SHA-256 через native FS |
| `packages/app-expo/src/lib/narra/catalog-cover-queue.ts` | Очередь ленивой загрузки обложек |
| `packages/app-expo/src/lib/narra/catalog-import-coordinator.ts` | Последовательный импорт и отмена зависшей загрузки |
| `packages/app-expo/src/screens/LibraryScreen.tsx` | Подключение каталога к экрану библиотеки |
| `packages/app-expo/src/lib/platform/expo-platform-service.ts` | Foreground native download с timeout/cancel |
| `packages/core/src/services/platform.ts` | Общий контракт `signal`/`timeoutMs` |

## Тесты, добавленные в ветке

В ветке добавлены или обновлены проверки для:

- разбора корректного и некорректного ответа каталога;
- получения подписанной ссылки;
- повторной выдачи ссылки после transient download failure;
- отмены активной нативной загрузки;
- ограничения очереди обложек по concurrency;
- дедупликации обложек;
- отмены очереди при закрытии экрана;
- отмены зависшего импорта при выборе другой книги;
- запрета параллельных локальных импортов;
- пустого bundled-каталога;
- переключения fallback Gateway на `api-test`.

Наличие этих тестов подтверждено по diff ветки. В рамках подготовки этого документа тестовый набор самой ветки не запускался.

## Что backend должен подтвердить перед merge

- [ ] `GET /v2/books/catalog?limit=100` доступен с installation token.
- [ ] В ответе есть массив `items` и хотя бы одна полная запись `resolution: "catalog"`.
- [ ] `source_download_path` и `cover.download_path` ведут на GET-эндпоинты Gateway.
- [ ] Эндпоинты ссылок возвращают `{ "download_url": "..." }`.
- [ ] Подписанная ссылка доступна с iOS Simulator/устройства без дополнительных заголовков.
- [ ] Реальный размер EPUB совпадает с `content_sha256`.
- [ ] Реальный размер обложки совпадает с `byte_size`, а содержимое — с `content_hash`.
- [ ] Время жизни подписанной ссылки больше времени обычной загрузки.
- [ ] Обработаны 401/403/429 и корректно возвращаются JSON-ошибки.
- [ ] Понятно, есть ли пагинация каталога больше 100 книг.
- [ ] Подтверждён отдельный источник персонажей и портретов после удаления bundled-данных.
- [ ] Принято решение, должен ли `production` использовать `api-test` или production Gateway.

## История commits в ветке

```text
8d924ffe chore(ios): use Narra test backend
3783afa0 feat(ios): load catalog books from backend
ee8cbd35 fix(ios): retry backend catalog downloads
4e3ceb33 fix(ios): cancel stuck catalog downloads
356e0f07 feat(ios): lazy-load catalog covers
```

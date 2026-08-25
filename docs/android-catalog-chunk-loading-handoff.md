# Android: прогрессивная загрузка каталожной книги чанками

## Цель

Мобильное приложение не должно скачивать всю каталожную книгу перед первым
открытием. Оно должно:

1. скачать первый текстовый чанк;
2. открыть ридер после первого чанка;
3. сохранить непрозрачный `next_cursor`;
4. запросить следующий чанк по мере чтения, до достижения конца книги.

Backend-протокол уже позволяет это сделать. Полная предварительная загрузка не
является требованием протокола — это было поведением клиента, который проходил
все курсоры в цикле до открытия ридера.

## Репозиторий и текущее состояние

- Репозиторий: `ATer-Oganisyan/readany`.
- Worktree: `/Users/avteroganisyan/projects/narra/readany-book-list-pagination`.
- Ветка: `codex/android-book-chunks-pagination`.
- Основной коммит прогрессивной загрузки: `6d62f4c1`.
- Коммит опубликован в `fork/codex/android-book-chunks-pagination`.
- TEST API: `https://api-test.narra.disrupt.builders`.

Реализация находится в следующих файлах:

- `packages/app-expo/src/lib/narra/backend-book-api.ts` — HTTP-контракт;
- `packages/app-expo/src/lib/narra/backend-catalog-source.ts` — первый чанк,
  последовательное продолжение, курсор и проверки целостности;
- `packages/app-expo/src/lib/narra/backend-catalog-stream-progress.ts` — расчёт
  загруженной доли и абсолютного прогресса;
- `packages/app-expo/src/lib/narra/backend-catalog-stream.ts` — добавление чанка
  и создание нового EPUB-снимка;
- `packages/app-expo/src/screens/LibraryScreen.tsx` — открытие после первого
  чанка;
- `packages/app-expo/src/screens/ReaderScreen.tsx` — догрузка по прогрессу и
  переключение EPUB-снимков;
- `packages/app-expo/assets/reader/reader.template.html` — безопасное закрытие
  предыдущего Foliate view перед открытием нового снимка.

## Контракт backend

Все запросы требуют installation token:

```http
Authorization: Bearer <installation_token>
```

Первый чанк:

```http
GET /v2/books/{bookEditionId}/content/chunks
```

Следующий чанк:

```http
GET /v2/books/{bookEditionId}/content/chunks?cursor=<next_cursor>
```

Ответ:

```ts
interface BookContentChunkResponse {
  contract_version: "book-content-v1";
  representation: "normalized-text-v1";
  book_edition_id: string;
  content_hash: string; // SHA-256 всего нормализованного текста
  text_length: number;  // длина всего текста в символах
  byte_size: number;    // размер всего текста в UTF-8 байтах
  chunk: {
    start_byte: number;
    end_byte_exclusive: number;
    content_hash: string; // SHA-256 UTF-8 байтов чанка
    text: string;
  };
  next_cursor: string | null;
}
```

Свойства протокола:

- backend задаёт размер чанка, максимум 64 KiB UTF-8;
- чанк не разрезает UTF-8 символ;
- `next_cursor` непрозрачный: его нельзя декодировать, изменять или вычислять;
- `next_cursor === null` означает конец книги;
- чанки доступны только последовательно;
- случайного доступа к произвольному чанку нет: для далёкого перехода клиент
  должен последовательно запросить промежуточные курсоры;
- `start_byte` и `end_byte_exclusive` — байтовые смещения, не JS string indexes;
- `409 CONTENT_VERSION_CHANGED` означает, что курсор относится к другой версии
  текста: локальный префикс нужно удалить и начать с первого чанка.

## Рекомендуемый алгоритм мобильного клиента

### Первое открытие

1. Выполнить запрос без cursor.
2. Проверить версию контракта, `book_edition_id`, границы и SHA-256 чанка.
3. Записать `chunk.text` в стабильное приватное хранилище приложения.
4. Сохранить рядом состояние загрузки:
   - `content_hash`;
   - `text_length` и `byte_size`;
   - полученные длины в символах и байтах;
   - `next_cursor`;
   - ранее встреченные курсоры для защиты от цикла.
5. Создать EPUB из полученного префикса и открыть ридер, не проходя остальные
   курсоры.

### Догрузка по прогрессу

Текущая политика клиента — запрашивать следующий чанк при достижении 60% уже
загруженного префикса:

```text
localReaderFraction >= 0.60 && nextCursor != null
```

После ответа:

1. проверить неизменность `content_hash`, `text_length` и `byte_size`;
2. проверить непрерывность байтовых границ и SHA-256 чанка;
3. дописать `chunk.text` в TXT-префикс;
4. атомарно сохранить новый cursor/state;
5. создать новый неизменяемый EPUB-снимок;
6. переключить WebView на новый снимок с сохранением CFI;
7. удалить предыдущий EPUB только после успешного переключения.

Не нужно ждать 100% текущего префикса: запас в 40% скрывает задержку сети и
конвертации.

### Прогресс по всей книге

Для русского текста нельзя использовать отношение UTF-8 байтов как точный
читательский прогресс. Использовать длину нормализованного текста:

```text
loadedFraction = receivedTextLength / textLength
absoluteProgress = localReaderFraction * loadedFraction
```

Счётчик locations по всей книге можно оценить так:

```text
estimatedFullLocations = loadedLocations / loadedFraction
```

Если пользователь перемещает общий ползунок дальше загруженной области, нужно
последовательно загрузить достаточное число чанков, создать один новый EPUB и
только затем выполнить переход.

## Важная модель состояния при переключении снимков

Нужно разделять два состояния:

- **received state** — сколько текста уже получено по сети;
- **rendered state** — какому объёму текста соответствует EPUB, который прямо
  сейчас открыт в Foliate.

Нельзя начинать рассчитывать прогресс старого WebView по новому received state до
того, как новый EPUB действительно открыт. Иначе возникает временный скачок
абсолютного прогресса.

Правильная последовательность:

1. получить следующий чанк и подготовить новый EPUB;
2. сохранить его state как pending, не меняя rendered state;
3. обновить `book.filePath`;
4. дождаться `loaded`/первого `relocate` именно от нового пути;
5. атомарно сделать pending state текущим rendered state;
6. восстановить CFI и продолжить сохранение прогресса.

До пункта 5 события старого WebView должны рассчитываться по старому rendered
state и не должны перезаписывать сохранённую позицию.

## Найденный runtime-дефект

На установленной сборке `6d62f4c1` проверено:

- «Король Лир» открылся после первого чанка;
- первый чанк составлял примерно 27,55% полного текста;
- при `localFraction = 0.606` был загружен второй чанк;
- ридер переключился с первоначального EPUB на
  `*-catalog-131072.epub`, то есть подключил 128 KiB текста.

При переключении обнаружен краткий скачок абсолютного прогресса примерно с
17,5% до 35,7%, после открытия нового EPUB прогресс вернулся примерно к 17,2%.
Причина: новый source state устанавливается до переключения WebView, и последнее
событие старого снимка умножается уже на новую загруженную долю.

Это клиентский дефект синхронизации, а не ограничение backend-протокола. Перед
финальной передачей необходимо применить описанное выше разделение received и
rendered state.

## Проверки и критерии приёмки

Автотесты до найденного runtime-дефекта:

- `33` test files;
- `266` tests passed;
- TypeScript `tsc --noEmit` passed.

Минимальная runtime-проверка на чистой установке:

1. Очистить данные или удалить приложение.
2. Открыть каталожную книгу.
3. Убедиться, что первый путь EPUB не содержит полного текста и
   `absoluteProgress < localReaderFraction`.
4. Дойти до 60% локального префикса.
5. Убедиться, что открылся путь `*-catalog-<receivedBytes>.epub`.
6. Проверить, что CFI и абсолютный прогресс не скачут вперёд или назад.
7. Повторить до `next_cursor === null`.
8. Перезапустить приложение и проверить восстановление cursor, EPUB и позиции.

Полезные команды:

```bash
cd /Users/avteroganisyan/projects/narra/readany-book-list-pagination/packages/app-expo
node ../../node_modules/vitest/vitest.mjs run src/lib/narra

cd /Users/avteroganisyan/projects/narra/readany-book-list-pagination
node node_modules/typescript/bin/tsc --noEmit -p packages/app-expo/tsconfig.json
```

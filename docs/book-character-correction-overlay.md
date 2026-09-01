# Backend overlay для точечных исправлений персонажей

## Статус

Код overlay подготовлен в ветке `codex/character-correction-overlay`. Он не развёрнут и не применён ни к одной книге. Мобильное приложение не изменялось.

Overlay предназначен для исправления уже опубликованной `book-markup-v3`, когда повторный полный анализ книги создаёт больше риска и затрат, чем пользы. Он не меняет исходную публикацию, не перезапускает pipeline и не создаёт новые `characterKey`.

## Что можно исправлять

- заменить или удалить `role` существующего персонажа;
- заменить или удалить `description` существующего персонажа;
- скопировать готовые `role` и `description` из существующего профиля-дубля;
- добавить алиасы существующему персонажу;
- перенаправить подтверждённый профиль-дубль на другой существующий `characterKey`.
- скрыть из reader projection заведомо смешанный профиль, если безопасной цели redirect нет.

Overlay не создаёт персонажей, evidence, сцены, чанки, публикации или новые версии классической разметки. Он не позволяет менять остальные поля профиля.

## Модель хранения

Миграция `026_book_character_corrections.sql` добавляет одну строку `book_character_corrections` на книгу. Строка содержит:

- точные идентификаторы базовых `book_markup_versions` и `book_analysis_publications`;
- SHA-256 базовой опубликованной разметки;
- нормализованный JSON correction и его SHA-256;
- состояние `draft`, `enabled` или `disabled`;
- оператора и время сохранения, включения и отключения.

Исходные `book_analysis_publications`, `book_markup_versions` и `book_characters` не изменяются. Отключение overlay сразу возвращает исходную выдачу.

## Предохранители

1. В correction можно ссылаться только на уже существующие `characterKey`.
2. Новый `characterKey` создать нельзя.
3. Redirect разрешён только на существующего персонажа; цепочки redirect запрещены.
4. Профиль, который redirect-ится, нельзя одновременно редактировать.
4a. `suppress` является единственным действием для профиля; скрытый профиль остаётся в исходной БД.
5. Копировать поле можно только из профиля, который в том же документе redirect-ится на получателя.
6. Новое `description` требует минимум два уже существующих evidence ID этого персонажа; `role` — минимум один.
7. Preview и enable повторно валидируют документ на текущей опубликованной разметке.
8. При изменении markup version, publication ID или content hash correction становится stale и не применяется.
9. Reader path при повреждённом документе или ошибке чтения overlay возвращает исходную разметку, а не ошибку пользователю.
10. Сохранение draft не включает его. Enable требует точный SHA-256 просмотренного документа.
11. Действующий overlay нельзя неявно перезаписать новым draft: сначала требуется явный disable.

## Формат файла для одной книги

```json
{
  "contractVersion": "book-character-correction-v1",
  "base": {
    "markupVersionId": "11111111-1111-4111-8111-111111111111",
    "publicationId": "22222222-2222-4222-8222-222222222222",
    "contentHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "reason": "Исправляем профиль по уже опубликованным evidence и подтверждённому дублю.",
  "changes": [
    {
      "characterKey": "character:helene",
      "reason": "Переносим готовые поля из ошибочно отдельного профиля полного имени.",
      "copy": {
        "roleFrom": "character:helene-bezukhova",
        "descriptionFrom": "character:helene-bezukhova"
      },
      "addAliases": [
        "Элен Безухова"
      ]
    },
    {
      "characterKey": "character:helene-bezukhova",
      "reason": "Это та же личность, отдельный профиль пользователю не нужен.",
      "redirectTo": "character:helene"
    }
  ]
}
```

Это только пример структуры. Идентификаторы нельзя переносить между книгами. Их следует брать из фактической опубликованной разметки выбранной книги.

Для нового текста вместо `copy` используется evidence-bound claim:

```json
{
  "set": {
    "role": {
      "value": "Светская красавица и влиятельная фигура высшего общества",
      "evidenceIds": ["existing-evidence-id"],
      "confidence": 0.86
    },
    "description": {
      "value": "Подробное непротиворечивое описание длиной не менее сорока символов.",
      "evidenceIds": ["existing-evidence-id-1", "existing-evidence-id-2"],
      "confidence": 0.84
    }
  }
}
```

## Операторский API

Все маршруты находятся под существующей Basic Auth защитой `/operator` и возвращают `Cache-Control: no-store`.

| Операция | Метод и путь | Изменяет выдачу |
|---|---|---|
| Состояние | `GET /operator/api/books/:id/correction` | Нет |
| Preview | `POST /operator/api/books/:id/correction/preview` | Нет |
| Сохранить draft | `PUT /operator/api/books/:id/correction` | Нет |
| Включить проверенный hash | `POST /operator/api/books/:id/correction/enable` | Да |
| Отключить | `POST /operator/api/books/:id/correction/disable` | Да, возвращает базу |

Тело enable/disable:

```json
{
  "documentHash": "sha256-из-preview-или-stage-без-префикса"
}
```

## Команда для работы через агента

Пароль передаётся только через окружение, а не через аргументы командной строки:

```bash
export BOOK_OPERATOR_URL='https://api.example.com/operator'
export BOOK_OPERATOR_USERNAME='narra'
export BOOK_OPERATOR_PASSWORD='...'
```

Безопасная последовательность для конкретной книги:

```bash
npm run operator:character-correction -- inspect --book <book-uuid>
npm run operator:character-correction -- preview --book <book-uuid> --file <book-correction.json>
npm run operator:character-correction -- stage --book <book-uuid> --file <book-correction.json>
npm run operator:character-correction -- inspect --book <book-uuid>
npm run operator:character-correction -- enable --book <book-uuid> --hash <reviewed-document-hash>
```

Rollback:

```bash
npm run operator:character-correction -- disable --book <book-uuid> --hash <enabled-document-hash>
```

Команды `inspect` и `preview` read-only. `stage` сохраняет только draft. Агент не должен выполнять `enable` без отдельного явного разрешения пользователя на выбранную книгу и конкретный `documentHash`.

Проверенные per-book документы следует хранить в `ops/book-character-corrections/<bookEditionId>.json`. Само появление файла ничего не запускает и не применяет.

## Как готовить correction для книги

1. Получить фактический опубликованный JSON через `GET /operator/api/books/:id/json`.
2. Получить точную базу и текущее состояние через `inspect`.
3. Проверить проблему по всем полям персонажа, evidence и возможным дублям.
4. Предпочитать `copy`, если корректные поля уже существуют в профиле-дубле. Это не требует LLM.
5. Использовать `set` только для текста, который доказуемо следует из существующих evidence.
6. Если evidence недостаточно или они противоречат друг другу, пометить книгу как требующую LLM и не создавать искусственный текст вручную.
7. Запустить preview и проверить `diff`, число персонажей после projection, роль, био, алиасы и redirect.
8. Сохранить draft и повторно прочитать состояние.
9. Только после отдельного подтверждения включить точный hash.
10. Проверить публичный manifest книги и при любой аномалии выполнить disable.

## Что происходит в reader path

Для активного и не stale correction backend строит проекцию в памяти:

- меняет только разрешённые поля профиля;
- удаляет redirect-профили из выдаваемого списка;
- удаляет suppress-профили из выдаваемого списка и их ссылки из событий, отношений и сюжетных арок;
- не ставит для suppress-профилей новые media warmup jobs и очищает их `characterKey` в TTS-проекции;
- переводит участников событий, отношения, сюжетные арки и TTS `characterKey` на сохраняемый ключ;
- дедуплицирует media warmup;
- сохраняет готовый media bundle дубля, если у канонического ключа его ещё нет;
- добавляет в manifest метаданные `correction.contract_version`, `version` и `document_hash`.

В базе и объектном хранилище при чтении ничего не переписывается.

## Развёртывание

1. Собрать backend image из этой ветки.
2. Прогнать полный gateway test suite в окружении с установленными production dependencies.
3. Снять backup PostgreSQL.
4. Выполнить обычный запуск gateway: migration runner применит `026_book_character_corrections.sql` под advisory lock.
5. Проверить health/ready и доступность operator API.
6. Выполнить только `inspect` и preview на одной тестовой книге.
7. Не включать correction в рамках самого deployment.
8. После отдельного решения применить stage/enable к одной книге, проверить manifest и rollback.
9. Только после успешного canary переходить к следующим явно выбранным книгам.

## LLM

Сам overlay не вызывает LLM. `copy`, redirect, aliases и публикация уже подготовленного evidence-bound текста выполняются чистой логикой backend.

LLM нужен только вне overlay, если в текущей разметке нет достаточных evidence/готового текста или требуется новое содержательное описание. Даже в этом случае LLM должен получить ограниченный evidence-пакет одного персонажа, а результат всё равно проходит тот же preview/stage/enable; полный pipeline книги не нужен.

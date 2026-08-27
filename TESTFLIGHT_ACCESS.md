# TestFlight: доступы и инструкция отправки

Документ подготовлен по соседнему треду «Проверка публикации Narra», локальному handoff и текущей конфигурации Expo. Цель — повторить отправку другого Expo/React Native-приложения в TestFlight.

Срез: 19 августа 2026 года.

## Быстрый маршрут

1. Войти в Expo/EAS и проверить аккаунт командой `eas whoami`.
2. Зарегистрировать приложение в App Store Connect и проверить точное совпадение bundle identifier.
3. Настроить production-профиль EAS: `APP_VARIANT=production`, production bundle ID, `ascAppId`, `autoIncrement: true`.
4. Собрать iOS production build.
5. Отправить его одной EAS Submit-задачей и дождаться результата.
6. После обработки в App Store Connect добавить build во внешнюю группу TestFlight.
7. Для внешних тестировщиков дождаться Beta App Review, затем включить public link или отправить приглашения.

## Найденные доступы и идентификаторы

### Expo / EAS

- Expo owner/account: `mishanaer`
- Expo login email: `mikhail.naer@gmail.com`
- Проект Narra в EAS: `readany`
- EAS project ID: `db152809-736c-4207-b073-38de82e61495`
- Проект в EAS: <https://expo.dev/accounts/mishanaer/projects/readany>
- Использованная production-команда сборки:

  ```bash
  cd /Users/manaer/Documents/Narra2/packages/app-expo
  APP_VARIANT=production pnpm exec eas build --profile production --platform ios
  ```

- Отправка из текущего репозитория:

  ```bash
  cd /Users/manaer/Documents/Narra2/packages/app-expo
  APP_VARIANT=production pnpm exec eas submit --profile production --platform ios
  ```

- Проверка сборок и отправок:

  ```bash
  pnpm exec eas build:list
  pnpm exec eas submit:list
  ```

### App Store Connect

- Приложение: `Narra`
- Production bundle identifier: `com.mishanaer.narra`
- App Store Connect app ID: `6801546949`
- Apple Team ID: `SBHVKH5UUY`
- App Store Connect API Key ID: `FFV92JLUP9`
- App Store Connect Issuer ID: `d8b33429-d4a7-418c-824a-45a168acda6f`
- Имя ключа в EAS: `[Expo] EAS Submit u-AOEomCd3`
- Роль ключа: `APP_MANAGER`
- Состояние: ключ хранится на EAS и доступен авторизованному аккаунту `mishanaer`.
- App Store Connect application URL:
  <https://appstoreconnect.apple.com/teams/d8b33429-d4a7-418c-824a-45a168acda6f/apps/6801546949>
- В `packages/app-expo/eas.json` production submit настроен через `ascAppId`.

### TestFlight

- Внешняя группа: `Narra External`
- External group ID: `84916db2-7c00-4b98-81c3-42e8a16e408a`
- UI группы:
  <https://appstoreconnect.apple.com/teams/d8b33429-d4a7-418c-824a-45a168acda6f/apps/6801546949/testflight/groups/84916db2-7c00-4b98-81c3-42e8a16e408a>
- Публичная ссылка:
  <https://testflight.apple.com/join/6h3wT64n>
- Тестировщику нужен обычный Apple Account с приложением TestFlight. Developer Account и invite-код не нужны при использовании public link.

## Что именно отправляли у Narra

- Версия: `1.3.5`
- iOS build: `36`
- IPA был собран и локально проверен: App Store distribution-подпись, правильный provisioning profile, `main.jsbundle`, 93 production-видео, размер около 255 MB.
- Историческая EAS Submit-задача:
  <https://expo.dev/accounts/mishanaer/projects/readany/submissions/cdee0fd9-672d-490d-a1a8-9daa09751496>
- Submission ID: `cdee0fd9-672d-490d-a1a8-9daa09751496`

Финальное состояние после ручного fallback:

```text
betaReviewState: APPROVED
externalBuildState: IN_BETA_TESTING
internalBuildState: IN_BETA_TESTING
```

Build 36 был добавлен в `Narra External`, для него обновили `What's New`, затем отправили на внешнее Beta Review. После одобрения public link стал рабочим для раздачи.

## Если EAS Submit зависает

В прошлый раз EAS-задача зависла в `Queued / Free Tier Queue` из-за инцидента с загрузками iOS в App Store Connect.

1. Сначала открыть существующую Submit-задачу и проверить её статус.
2. Пока статус `Queued`, не отправлять IPA повторно и не создавать дублирующий build.
3. Если задача завершилась ошибкой или отменена, использовать уже собранный IPA либо создать одну новую Submit-задачу.
4. Для ручного fallback загрузить IPA через `xcrun altool` с временным App Store Connect API key с ролью `App Manager`:

   ```bash
   xcrun altool \
     --upload-app \
     --type ios \
     --file "$IPA" \
     --apiKey "$ASC_KEY_ID" \
     --apiIssuer "$ASC_ISSUER_ID"
   ```

5. Проверить, что build появился в App Store Connect со статусом `VALID`.
6. Добавить build во внешнюю группу, заполнить `What's New` и отправить на Beta App Review.
7. После одобрения проверить public link с устройством, которое не имеет developer-доступа.
8. Временный `.p8` private key удалить после загрузки. Не сохранять его в репозитории или в этом документе.

## Реестр паролей и секретов

Сырые значения паролей, токенов и private keys в соседних тредах не найдены. В треде отдельно зафиксировано правило не раскрывать ключи и секреты. Проверка EAS показала, что API key действительно хранится удалённо на EAS, но локального `.p8` нет. Поэтому ниже указано, где нужен доступ, но не продублированы секретные значения:

| Доступ | Что известно | Где брать секрет |
|---|---|---|
| Expo/EAS | Аккаунт `mishanaer`; нужен доступ к проекту `readany` | Войти интерактивно через `eas login` или через браузер; пароль в MD не хранить |
| App Store Connect | App ID `6801546949`; Key ID `FFV92JLUP9`; Issuer ID `d8b33429-d4a7-418c-824a-45a168acda6f`; роль `App Manager` | Для обычного `eas submit` достаточно EAS Credentials; для локального `altool` нужен отдельный `.p8` |
| Apple Account / 2FA | Для внешнего тестировщика нужен обычный Apple Account | Пользователь вводит сам на устройстве; пароль и коды в тред/MD не передавать |
| TestFlight public link | Публичная ссылка уже содержит нужный код присоединения | Отдельный invite-код не нужен |

Не найдено и не следует придумывать:

- пароль Expo;
- email Apple Account;
- содержимое ASC `.p8` private key;
- EAS access token.

Локальная проверка пути из скриншота:

```text
/Users/manaer/.appstoreconnect/private_keys — отсутствует
AuthKey_FFV92JLUP9.p8 — локально не найден
```

## Что проверить для другого приложения

- Bundle identifier не совпадает с Narra и зарегистрирован в App Store Connect.
- `ascAppId` указывает на новое приложение.
- Production profile не использует preview bundle ID `com.readany.app.preview`.
- Версия и build number увеличиваются; в текущем EAS production-профиле включён `autoIncrement: true`.
- В production-сборку попал production backend и нужные assets.
- После загрузки build отображается как `VALID`, а не только как загруженный файл.
- Для внешней группы пройдена Beta App Review.
- Public link или приглашение проверены на чистом устройстве.

## Важное ограничение текущего Narra-репозитория

Сейчас production-профили EAS в рабочем дереве используют gateway:

```text
https://api-test.narra.disrupt.builders
```

Перед публикацией другого приложения нужно отдельно проверить URL backend и не переносить тестовый gateway в production случайно.

## Источники

- Соседний тред: «Проверка публикации Narra».
- Локальный handoff: `AGENT_HANDOFF_BEFORE_2026-08-19.md`.
- Текущая конфигурация: `packages/app-expo/eas.json`, `packages/app-expo/app.config.js`, `packages/app-expo/scripts/app-variant.js`.

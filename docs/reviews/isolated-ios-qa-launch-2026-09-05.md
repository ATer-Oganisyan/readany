# Отдельный iOS-контейнер для LOCAL QA

Цель — проверять собственные LOCAL книги без переключения существующей TEST
библиотеки. Полная изоляция Narra state/SQLite внутри одного контейнера ещё
не реализована; новый симулятор отделяет эти данные физически.

## Изменение wrapper

`packages/app-expo/script/build_and_run.sh install-canonical-only` требует
точный UDID, проверяет Xcode/pasteboard/dependencies, актуальный fingerprint,
build/bundle/hash готового canonical `.app`. По authoritative listapps
установка разрешается только при отсутствии приложения. Неясный inventory
или lookup — ошибка; другую установленную сборку не заменяет, совпадающую
оставляет. Может загрузить выбранный симулятор для listapps, но не вызывает
prepare, reader build, xcodebuild, prebuild, pods, Metro или запуск приложения.

LOCAL либо `READANY_STRICT_METRO_LAUNCH=1` требует dev-client URL с выбранным
localhost-портом до запуска. Независимое ревью обнаружило промежуток между
обычным launch и openurl, в котором dev-client мог выбрать most-recent TEST.
Strict ветка теперь делает только terminate выбранного приложения и openurl
проверенной ссылки; промежуточного launch нет. Remote Run не изменён.
`.codex` actions и ежедневная команда Run сохранены, туннели не добавлялись.

## Проверки

Agent:23 shell behavioral PASS, полный mobile168 suites/1510 PASS,
TypeScript, bash-n, help и diff-check PASS. Shell tests исполняют функции
wrapper с контролируемыми CLI, а не ищут строки исходника. До исправления
strict race соответствующий тест упал, после — прошёл.

Root реально выполнил install-canonical-only на отдельном iPhone Air:
`984D0C64-C0B2-4204-92A9-2C65519089E8`, iOS26.5, та же Xcode26.5/17F42.
До установки NARRA отсутствовала. Установка завершилась exit0; последующий
wrapper check подтвердил installed36/canonical36/fingerprint CURRENT.
Приложение не запускалось, отдельный Metro8082 ещё не стартовал.

**Предупреждение первого boot:** simctl вывел Data Migration Failed, после
чего установка завершилась успешно. Это не устранённая ошибка iOS и не
принятый runtime-сценарий. Не выполнялись erase/reset/rebuild в обход неё;
нужен отдельный фактический запуск и проверка приложения.

Существующие TEST iOS/Android не переустанавливались и не переводились на LOCAL.
TEST Metro8081 сохранён. Для будущего LOCAL запуска нужны отдельный порт,
явный localhost gateway URL через env процесса, strict URL и проверка
фактической конфигурации bundle; `.env` и TEST-контейнер копировать не нужно.

Использованы Expo Run Actions и Expo dev-client: существующий dev-client нужен
из-за native modules проекта; новый облачный build/TestFlight не запускался.

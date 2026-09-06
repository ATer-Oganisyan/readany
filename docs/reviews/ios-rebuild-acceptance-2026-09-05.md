# iOS: актуальная нативная сборка и сохранность данных

## Сборка

Коммит runtime: `667ae9b04eeb40518ff76a6611dccbd8b388b48b`.
Использованы Expo dev-client skill и канонический `script/build_and_run.sh`.
Никаких EAS/TestFlight, туннелей, очистки Pods/DerivedData или смены Xcode.

- iPhone 17 Pro Max, UDID `391D4246-C13E-42B6-B7AF-15D3B7FD9DC6`.
- Xcode26.5/17F42, единственный соответствующий Simulator UI; pasteboard sync=0.
- До rebuild: build36 установлен, зависимости и Pods согласованы, fingerprint
  изменён после обновления patched dependency.
- `rebuild-ios` завершился **BUILD SUCCEEDED**. Канонический бинарный hash
  совпал с уже установленным build36: скрипт корректно не переустанавливал
  идентичный бинарник. Android-only изменение TrackPlayer не выдаётся за
  изменение iOS-кода.
- Последующий `check`: **Native fingerprint: current**. Приложение запущено,
  root увидел Library → My books без RedBox. Это Debug Simulator, не release.

## Сохранность

Перед build сохранён полный APFS clone контейнера (114 МиБ) и отдельные
SQLite `.backup` обеих БД:
`/private/tmp/narra-ios-before-rebuild.bTLNZ1/`.
Файлы резервной копии не публикуются в репозиторий.

Первое открытие copied WAL-mode DB через `-readonly` вернуло SQLite14;
обычное открытие самих резервных копий позволило завершить их локальную
WAL-инициализацию. Обе consistent copies прошли `PRAGMA quick_check = ok`.
Оригинальные БД читались только read-only; данные не очищались.

До rebuild: books20, bookmarks0. После запуска, до QA-навигации, сравнение
всех строк books по id/file_path/format/content_hash/progress/current_cfi/
native_locator/deleted_at в одинаковом порядке дало **точное совпадение**:
SHA256 `6f7a007cdcc013271c929f2d54d324cffb572132d9e068aa471d6a5d3a295bab`.
Таким образом сохранены идентичности файлов и позиции всех двадцати записей,
а не только количество карточек. Пользовательская исходная книга не открывалась.

## Независимая приёмка и ограничения

UI QA получил sole ownership iOS; Android оставлен idle. Проверяются только
собственные «Аудит08/09»: чтение → закладка → список → точный возврат → удаление,
FBZ → Characters, подготовка и Cancel. Управление Simulator — через wrapper.
Результаты этого прохода публикуются отдельно; сборка/Library/SQL-сравнение
не заменяют поведения WebView, озвучки и AI-функций.

CI точного коммита завершён: **675 core + 1475 mobile + 807 backend PASS**,
backend без пропусков с PostgreSQL/S3, TypeScript и production image build PASS.
Это не deployment: PR77 открыт, publish-test-image пропущен штатно.
Живые AI/TTS, physical iOS, signed release и нагрузка на тысячи клиентов
этим checkpoint не приняты.

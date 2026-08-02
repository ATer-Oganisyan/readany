# Генерация иконок приложения через CLI

Иконки Narra генерируются одной командой из векторных слоёв. На iOS результатом становится
настоящий многослойный пакет `.icon` с вариантами Default, Dark и Tinted. На Android создаётся
adaptive icon с отдельными foreground, background и monochrome-ресурсами.

Icon Composer вручную открывать не требуется. Его CLI `ictool` используется для проверки и
рендера готового `.icon`-пакета.

## Исходники и результат

Исходные слои:

```text
assets/app-icon-layers/
├── 01-book.svg
└── 02-character.svg
```

Генератор:

```text
scripts/generate-app-icons.js
```

Создаваемые файлы:

```text
assets/
├── Narra.icon/
│   ├── icon.json
│   └── Assets/
│       ├── 00-dark-background.svg
│       ├── 01-book.svg
│       ├── 01-book-dark.svg
│       ├── 02-character.svg
│       └── 02-character-dark.svg
├── icon.png
├── adaptive-icon.svg
├── adaptive-icon.png
├── adaptive-icon-monochrome.svg
├── adaptive-icon-monochrome.png
└── splash-icon.png
```

`icon.png` нужен как общий legacy fallback. iOS использует не его, а `Narra.icon`.

## Как работает генератор

Скрипт `scripts/generate-app-icons.js` выполняет следующие операции:

1. Читает два смысловых SVG-слоя: книгу и персонажа.
2. Создаёт светлые и тёмные векторные варианты, не превращая их в PNG.
3. Собирает `Narra.icon/icon.json` с тремя группами в z-порядке:
   `Character → Book → Background`.
4. Через `opacity-specializations` задаёт видимость слоёв для Default, Dark и Tinted.
5. Для Tinted использует системную автоматическую заливку, поэтому цвет выбирает iOS.
6. Создаёт Android foreground в безопасной зоне adaptive icon.
7. Создаёт отдельную чёрную monochrome-маску для тематических иконок Android.
8. Через Sharp рендерит PNG-ресурсы, которые принимает Android-пайплайн Expo.
9. Создаёт светлый `splash-icon.png` из тех же слоёв внутри скруглённой маски для тёмного
   splash-фона.

На iOS книга, персонаж и фон остаются отдельными слоями. Xcode применяет к `.icon` системную
форму, материалы и варианты оформления при сборке.

## Генерация

Из корня репозитория:

```bash
pnpm --filter @readany/app-expo generate:icons
```

Или из каталога приложения:

```bash
cd packages/app-expo
pnpm generate:icons
```

Команда перезаписывает только сгенерированные icon assets.

## Проверка `.icon` через Apple CLI

Нужен Xcode с Icon Composer и `ictool`. Для обычной установки Xcode:

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
ICON_TOOL="$(xcrun --find ictool)"
```

Если используется Xcode Beta в другом каталоге, укажите его `DEVELOPER_DIR`, например:

```bash
export DEVELOPER_DIR=/Users/manaer/Downloads/Xcode-beta.app/Contents/Developer
ICON_TOOL="$(xcrun --find ictool)"
```

Создание всех превью:

```bash
cd packages/app-expo

ICON=assets/Narra.icon
PREVIEW_DIR="${TMPDIR%/}/narra-icon-preview-cli"
mkdir -p "$PREVIEW_DIR"

"$ICON_TOOL" "$ICON" \
  --export-image \
  --output-file "$PREVIEW_DIR/default.png" \
  --platform iOS \
  --rendition Default \
  --width 1024 \
  --height 1024 \
  --scale 1

"$ICON_TOOL" "$ICON" \
  --export-image \
  --output-file "$PREVIEW_DIR/dark.png" \
  --platform iOS \
  --rendition Dark \
  --width 1024 \
  --height 1024 \
  --scale 1

"$ICON_TOOL" "$ICON" \
  --export-image \
  --output-file "$PREVIEW_DIR/tinted-light.png" \
  --platform iOS \
  --rendition TintedLight \
  --width 1024 \
  --height 1024 \
  --scale 1 \
  --tint-color 0.65 \
  --tint-strength 0.65

"$ICON_TOOL" "$ICON" \
  --export-image \
  --output-file "$PREVIEW_DIR/tinted-dark.png" \
  --platform iOS \
  --rendition TintedDark \
  --width 1024 \
  --height 1024 \
  --scale 1 \
  --tint-color 0.08 \
  --tint-strength 0.75

open "$PREVIEW_DIR"
```

Если `ictool` завершился с кодом `0` и создал четыре изображения, структура `.icon`, SVG-слои и
appearance-аннотации успешно прочитаны Apple renderer.

Дополнительная проверка исходных файлов:

```bash
xmllint --noout \
  assets/Narra.icon/Assets/*.svg \
  assets/adaptive-icon.svg \
  assets/adaptive-icon-monochrome.svg

node -e "JSON.parse(require('fs').readFileSync('assets/Narra.icon/icon.json')); console.log('icon.json valid')"
```

## Подключение к Expo

Иконки подключены в `app.config.js`:

```js
ios: {
  icon: "./assets/Narra.icon",
},
android: {
  adaptiveIcon: {
    foregroundImage: "./assets/adaptive-icon.png",
    monochromeImage: "./assets/adaptive-icon-monochrome.png",
    backgroundColor: "#FFFFFF",
  },
},
```

Проверка разрешённого Expo-конфига:

```bash
cd packages/app-expo
APP_VARIANT=development pnpm exec expo config --type public
```

Синхронизация с существующими native-проектами:

```bash
APP_VARIANT=development pnpm exec expo prebuild --no-install --platform ios
APP_VARIANT=development pnpm exec expo prebuild --no-install --platform android
```

После iOS prebuild Expo:

- копирует `Narra.icon` внутрь Xcode-проекта;
- добавляет пакет в Resources;
- задаёт `ASSETCATALOG_COMPILER_APPICON_NAME = Narra`.

После Android prebuild Expo:

- создаёт foreground для всех density;
- создаёт monochrome для всех density;
- добавляет ссылки `foreground`, `background` и `monochrome` в `ic_launcher.xml`.

## Почему Android использует PNG

Android adaptive icon остаётся многокомпонентной системной иконкой, но Expo SDK 55 не принимает
SVG напрямую в `android.adaptiveIcon`. Поэтому SVG хранится как редактируемый источник, а генератор
создаёт из него прозрачные PNG для foreground и monochrome.

Это не единая сплющенная иконка: Android по-прежнему отдельно получает фон, основной рисунок и
монохромную маску, а затем применяет форму launcher-а на устройстве.

## Найденные при проверке ошибки

### Фон перекрывал рисунок в Dark

В формате Icon Composer первая группа является передней. Изначальный порядок помещал Background
поверх книги и персонажа. `ictool --rendition Dark` показал пустую тёмную иконку. Исправленный
порядок: `Character → Book → Background`.

### Тёмная книга превращалась в сплошную фигуру

Принудительный `fill` в `icon.json` заливал замкнутый path книги вместо сохранения его stroke.
Поэтому тёмный вариант теперь создаётся отдельным SVG с заменой цвета, но с исходными
`stroke`/`fill`-атрибутами.

### Android prebuild отклонял SVG

Expo завершал prebuild ошибкой `Invalid mimeType for image`. Конфиг Android был переключён на
сгенерированные PNG, а векторные SVG оставлены источниками генерации.

## Как обновить дизайн

1. Отредактируйте `assets/app-icon-layers/01-book.svg` и/или
   `assets/app-icon-layers/02-character.svg`.
2. При необходимости измените цвета и масштаб adaptive icon в
   `scripts/generate-app-icons.js`.
3. Запустите `pnpm generate:icons`.
4. Повторите четыре рендера через `ictool`.
5. Запустите Expo prebuild для обеих платформ.
6. Пересоберите приложение.

Fast Refresh и перезапуск Metro не обновляют иконку уже установленного приложения: изменение
домашней иконки требует новой native-сборки и повторной установки.

Splash также обновляется только после native prebuild и новой сборки приложения.

## Ссылки

- [Apple: Creating your app icon using Icon Composer](https://developer.apple.com/documentation/Xcode/creating-your-app-icon-using-icon-composer)
- [Apple: Icon Composer](https://developer.apple.com/icon-composer/)
- [Expo: App icons](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/)

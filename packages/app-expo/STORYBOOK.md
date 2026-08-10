# Storybook для мобильных компонентов

Каталог работает внутри `Narra Dev`, поэтому на iOS он показывает настоящие SwiftUI-компоненты, а на Android — Jetpack Compose. Обычное приложение и Storybook используют один dev build; отличается только JS-вход Metro.

## Запуск Storybook

```bash
pnpm --filter @readany/app-expo storybook:start
```

Откройте появившийся QR-код через камеру iPhone или Android. Если dev build уже открыт, нажмите `r` в терминале Metro.

## Лёгкий стенд читалки

Он подключает только состояния интерфейса читалки, без реальной книги, WebView, базы и сети:

```bash
pnpm --filter @readany/app-expo storybook:reader
```

В Storybook откройте `Читалка → Все состояния`. В `Песочнице` можно переключать сценарий,
тему и размер текста через Controls; рядом находятся отдельные истории для быстрой визуальной
проверки каждого сценария.

## Возврат к приложению

Остановите Storybook (`Ctrl+C`) и запустите:

```bash
pnpm --filter @readany/app-expo start -- --tunnel
```

## Где лежат истории

- `.rnstorybook/` — конфигурация on-device Storybook;
- `src/**/*.stories.tsx` — истории компонентов;
- `src/components/ui/NativeButton.*.tsx` — платформенные реализации кнопки.

После добавления нового общего UI-компонента добавьте рядом файл `ComponentName.stories.tsx`. Metro автоматически обновит `storybook.requires.ts`.

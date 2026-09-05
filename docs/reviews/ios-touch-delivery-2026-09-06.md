# iOS: Characters не открылся после успешного шага автоматизации

## Проверенное различие

В проходе 00:11:12 semantic selector нашёл видимую надпись Characters,
её bounds `[299,842][383,862]`, и отправил tap в `(341,852)`.
Maestro сообщил COMPLETED, но settled screenshot оставался Reader.
В последующем проходе 00:12:11 physical tap `(327,857)` открыл Characters.
Оба события запрашивали одинаковую длительность касания 0.10 секунды.

Основной агент сопоставил системные логи двух реальных проходов:

| Наблюдение | Не открылось | Открылось |
| --- | ---: | ---: |
| `skipping event` из-за отсутствующего предшествующего touch | 10 | 0 |
| `contact 2 presence: none` | 0 | 1 |
| Удаление digitizer с ещё активным `touching` | Да | Нет |
| XCTest сообщил `TouchEventsCompleted` | Да | Да |

В неудачном проходе backboardd повторно инициализировал неизвестный digitizer,
пропускал события и отменил оставшееся активное касание при удалении digitizer.
В успешном проходе зарегистрировано снятие касания до удаления digitizer.
Само сообщение `digitizer did disappear` без проверки оставшихся контактов
не является признаком ошибки: оно есть и после успешного tap.

Это прямое свидетельство сбоя доставки синтетического касания в неудачном
проходе, но не доказательство исправности приложения во всех случаях и не
доказательство причины сбоя драйвера. Координаты двух проходов различались.
Нет оснований менять действие UIButton с `touchUpInside` на `touchDown`:
это активировало бы кнопку даже при отменённом пользователем касании.

## Проверка приложения

Кнопка Characters вызывает native dispatcher по `touchUpInside`.
JS публикует текущий прогресс и захватывает видимую страницу через локальный
WebView bridge. Захват ограничен 650 мс; ошибка/таймаут допускает открытие,
а смена книги, страницы или reader session отменяет устаревшее открытие.
AI-запрос не входит в обработчик открытия.

На неизменённом isolated JS e581688 / Node 24.20.0 прошли 24 теста в трёх
файлах: character-reading-context, reader-bridge-requests,
reader-toolbar-preparation. Это не замена проверки native доставки события.

## Артефакты

- Неудачный лог:
  `/private/tmp/narra-air-sep06-half/2026-09-06_001105/narra-air-characters-unavailable/logs/device-simulator.log`
  SHA256 `746d60fc88171f37bab1a5dece4d9a78a2c87629af9c8b77d29c91c3e4abc051`.
- Успешный лог:
  `/private/tmp/narra-air-sep06-physical/2026-09-06_001204/narra-air-characters-physical/logs/device-simulator.log`
  SHA256 `07ff72118bd065bfaff1f76d1762d1c3703a6be663e9477efee409be2927fbb6`.

Дальнейшая приёмка требует повторов из подтверждённого Reader и проверки
реального состояния экрана после каждого tap. COMPLETED тестового шага
не считается успешным открытием. Production UI и runtime в этой диагностике
не менялись; VoiceOver и физическое устройство остаются непроверенными.

## Повторный проход без изменений приложения

Два semantic-нажатия по той же надписи и одно physical-нажатие открыли sheet.
Первый новый semantic screenshot основной агент просмотрел самостоятельно.
При третьем закрытии sheet жестом автоматизация снова сообщила COMPLETED,
но screenshot фактически сохранил окно Characters. Основной агент подтвердил
это изображение; следующее нажатие Characters не выполнялось, поскольку
не было исходного Reader. Новый сбой не относится к JS-обработчику кнопки.

В логе этого неудачного swipe: 30 `skipping event`, 0 `contact 2 presence: none`,
удаление digitizer с активным `touching`. Путь:
`/private/tmp/narra-tap-compare-dismiss3/2026-09-06_002152/narra-air-characters-dismiss/logs/device-simulator.log`,
SHA256 `ba03aec4b73464f067beaa69bbba0d86c8b1a584053877eca8d23a63d873d3df`.
Это повторение диагностического признака на другом жесте. Оно усиливает
вывод о сбое синтетического ввода, но причина внутри simulator/driver
ещё не локализована и общий UI gate не принят.

После осмотра один отдельный cleanup-свайп вернул Reader, что основной агент
подтвердил по screenshot. Второй physical tap не выполнялся. Сравнение
`/private/tmp/narra-tap-compare-baseline.json` и
`/private/tmp/narra-tap-compare-final.json` независимо подтвердило точные
ID/CFI/progress/contentHash/fileHash всех трёх книг. UI оставлен в Reader.

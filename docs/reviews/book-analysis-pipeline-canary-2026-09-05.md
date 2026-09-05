# Полный worker → DB pipeline: управляемый canary

## Результат

Root выполнил `scripts/qa/book-analysis-pipeline-canary.mjs --run-mock` на
отдельной пустой PostgreSQL БД `narra_qa_pipeline_20260905_root03`, localhost55438.
Exit0, run `29929e50-25c5-4564-841f-6b61c91f9839`.

Собственный текст: «Анна всегда была честной. Однажды Анна торопливо закрыла окно.»
SHA256 `68a145f2de643d7e646d677e6772ae2323184bcc906a76fe6457ff28c77e5998`.

Настоящие worker factories/repository/migrations/internal HTTP router/client/
generation service, in-memory object storage и **mock completeChat**:

1. prepare;
2. scan;
3. resolve;
4. synthesize profile;
5. assemble;
6. validate;
7. publish.

Проверены две observations с точными quote offsets, связи evidence IDs,
profile artifact, успешный validation report, published markup и одна
публикация с одним персонажем. Повтор ensure возвращает тот же run;
все workers после завершения idle, новых model calls нет.

Четыре mock-вызова: scan7509 / profile9670 / recall3547 / audit5381 байт
сериализованных messages. Это не полное provider HTTP body и не токены.

Primary mock намеренно добавляет «тревожная» по единичному действию.
Audit mock сохраняет только «честная»; настоящий pipeline применяет этот
результат и публикует только её. **Это проверка исполнения контракта аудита,
не доказательство, что живая модель сама правильно отфильтрует гипотезу.**

## Исправления самого стенда

Первый запуск root01 остановился на seed: приватный source_storage не может
использовать default stored. Исправлен fixture на temporary с expiry1day;
production constraint не менялся. Второй root02 остановился до jobs:
in-memory storage не реализовывал обязательный getBytesRange. Добавлен
actual byte-range contract и model-free проверка всех шести factories.
Эти отказы не объявляются багами продукта и не засчитываются как PASS.

Все три БД созданы специально root; schema оставлена для диагностики.
Собственные edition/run rows удаляются в finally. После root02 отдельно
проверены нулевые counts; исходные пользовательские и TEST базы не менялись.

## Что дальше

Живой scan + профиль v14 требует минимум4 последовательных вызова.
Recall/audit включают предыдущие живые ответы, поэтому их точные SHA нельзя
честно заранее взять из mock-прогона. Для live нужен поэтапный capture-stop:
прочитать фактический следующий запрос, отдельно разрешить его точные байты,
после ответа повторить. Не менять v14, не выключать audit и не считать mock
части живыми ради лимита тестового bridge.

Ещё не проверено: полноценная многочанковая книга, большие evidence sets,
несколько персонажей, живые prompts/quality/latency, мобильный UI, S3,
изображения, аудио и нагрузка. Этот маленький fixture не означает release ready.

## Добавлен staged-контроллер: проверен только mock

`--stage-mock` и явный `--stage-live` фиксируют каждый фактический provider body
в отдельной приватной папке. Контроллер ждёт внешний approval с точными
index/SHA/nonce; сам approval не создаёт. Папка недоступна дочернему model
fixture, каждый bridge допускает1вызов; последовательность scan/profile/recall/
audit, общий предел4. Любая ошибка, квота, изменённое тело, лишний этап или
отсутствие approval останавливает кампанию без fallback/retry. Default/mock
не могут случайно запустить живой CLI; live отвергает mock injection.

Root выполнил полный staged-mock тест на новой БД
`narra_qa_pipeline_20260905_root04`: **15 PASS,0 FAIL,0 SKIP**.
В mock-тесте отдельный тестовый reviewer читает файлы и пишет approvals;
это не механизм автоматического разрешения live. Фактический staged-live
worker→DB прогон ещё не выполнялся.

До live зафиксирован semantic gold: каждая quote точно соответствует offsets,
есть grounded trait/action evidence; допустимы дополнительные подтверждённые
observations. Профиль сохраняет только формы «честная/честный/честность» с
ссылкой на прямое утверждение рассказчика. Черта из одного действия, неверная
цитата и выдуманные evidence IDs отвергаются. Mock сохраняет прежние строгие
counts. Критерии не будут ослабляться задним числом ради зелёного прогона.

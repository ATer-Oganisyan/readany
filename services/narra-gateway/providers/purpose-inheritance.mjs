/**
 * Наследование настроек между назначениями.
 *
 * Назначение, добавленное рядом с существующим, обязано вести себя как оно,
 * пока ему не задали своё: иначе появление `roster_confirm` увело бы стадию на
 * маршрут по умолчанию молча и у всех сразу.
 *
 * Живёт отдельным модулем, потому что по цепочке ходят двое — выбор маршрута и
 * выбор формы запроса, — и они импортируют друг друга. Пока цепочка была
 * приватной для маршрутов, форма запроса про неё не знала: `roster_confirm`
 * наследовал модель структурных задач, но уходил без `response_format`, хотя
 * ответ разбирается как JSON.
 */
export const PURPOSE_PARENT = Object.freeze({ roster_confirm: 'structured_task' })

export function purposeChain(purpose) {
  const chain = [purpose]
  let current = purpose
  while (PURPOSE_PARENT[current]) {
    current = PURPOSE_PARENT[current]
    chain.push(current)
  }
  return chain
}

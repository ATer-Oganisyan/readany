/**
 * Страница дашборда и её скрипт.
 *
 * CSP операторского роутера запрещает и внешние источники, и инлайновые
 * скрипты: страница с чужим `<script src>` или с инлайном молча не оживёт —
 * браузер не покажет ошибку в интерфейсе, а оператор увидит пустой дашборд.
 * Отсюда же второй инвариант: каждый идентификатор, который скрипт ищет в
 * документе, обязан в документе быть — опечатка в `getElementById` даёт
 * `null.textContent` и обрывает отрисовку целиком.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const html = await readFile(new URL('../operator-ui/status.html', import.meta.url), 'utf8')
const script = await readFile(new URL('../operator-ui/status.js', import.meta.url), 'utf8')

test('the dashboard loads only same-origin assets and no inline script', () => {
  const sources = [...html.matchAll(/<(?:script|link)[^>]*(?:src|href)="([^"]+)"/g)]
    .map(([, value]) => value)
  assert.ok(sources.length >= 3)
  for (const source of sources) {
    assert.ok(source.startsWith('./'), `внешний ресурс на странице: ${source}`)
  }
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/)
  assert.match(html, /<script type="module" src="\.\/assets\/status\.js"><\/script>/)
})

test('every element the script looks up exists in the document', () => {
  const ids = new Set([...script.matchAll(/'([a-z-]+)'/g)]
    .map(([, value]) => value)
    .filter((value) => script.includes(`elements['${value}']`)))
  assert.ok(ids.size >= 6, 'скрипт перестал искать элементы по идентификаторам')
  for (const id of ids) {
    assert.match(html, new RegExp(`id="${id}"`), `в разметке нет элемента #${id}`)
  }
  // `.live-state` берётся селектором, а не по идентификатору, и тоже обязан быть.
  assert.match(html, /class="live-state"/)
})

test('the dashboard only reads, so a stray operator click cannot change state', () => {
  // Управление живёт на странице книги: там видно, что именно ломается.
  assert.doesNotMatch(script, /method:\s*'(POST|PUT|DELETE|PATCH)'/i)
  assert.match(script, /fetch\('\.\/api\/progress'/)
})

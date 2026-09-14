/**
 * Список книг, запущенных в конвейер карточек, по времени запуска.
 *
 * Дашборд `status` показывает два десятка книг и отвечает на «что происходит
 * сейчас». У перевода каталога вопрос другой — «что мы уже запустили и где оно
 * стоит»: книга, вставшая три сотни запусков назад, в короткий снимок не
 * попадает вообще. Поэтому здесь список целиком и одной таблицей.
 *
 * Страница только читает `/operator/api/cards-runs`; перезапуск живёт на
 * странице книги, где видно, что именно сломалось.
 */

const REFRESH_MS = 10_000

const stageLabels = {
  prepare: 'Подготовка',
  resolve: 'Связи сущностей',
  synthesize: 'Синтез',
  validate: 'Проверка',
  publish: 'Публикация'
}

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'published', label: 'Опубликованы' },
  { id: 'working', label: 'В работе' },
  { id: 'failed', label: 'С ошибками' },
  { id: 'stuck', label: 'Без публикаций' }
]

const elements = Object.fromEntries([
  'runs-body', 'runs-note', 'runs-empty', 'search', 'filters', 'sort-toggle',
  'live-label', 'auto-refresh'
].map((id) => [id, document.getElementById(id)]))
const liveState = document.querySelector('.live-state')

let snapshot = { runs: [] }
let filter = 'all'
let newestFirst = true

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character])
}

function startedAt(value) {
  if (!value) return '—'
  const date = new Date(value)
  return date.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

function age(value) {
  if (!value) return ''
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000)
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return `${Math.floor(hours / 24)} дн назад`
}

/**
 * Состояние книги одной строкой.
 *
 * Стадия карточного прогона всегда «Публикация»: он доходит до неё и остаётся
 * там, пока открываются окна. Показывать её значит не показывать ничего —
 * движение здесь в закрытых окнах, а беда в нуле публикаций при готовых
 * карточках.
 */
function state(run) {
  if (run.status === 'failed') return { tone: 'bad', text: `Упал на «${stageLabels[run.stage] ?? run.stage}»` }
  if (run.status === 'cancelled') return { tone: 'warn', text: 'Отменён' }
  if (run.status === 'queued') return { tone: '', text: 'В очереди' }
  if (!run.cards) return { tone: '', text: 'Собираются карточки' }
  if (!run.publications) {
    return run.windows.ready
      ? { tone: 'bad', text: 'Не опубликована' }
      : { tone: '', text: 'Первое окно собирается' }
  }
  if (run.windows.total && run.windows.ready >= run.windows.total) {
    return { tone: 'ok', text: 'Готова' }
  }
  return { tone: 'ok', text: 'Публикуется по окнам' }
}

function matchesFilter(run) {
  const { tone, text } = state(run)
  if (filter === 'published') return tone === 'ok'
  if (filter === 'failed') return run.status === 'failed' || run.failedJobs > 0
  if (filter === 'working') return run.status === 'running' && text !== 'Готова'
  if (filter === 'stuck') return !run.publications
  return true
}

function visibleRuns() {
  const query = elements.search.value.trim().toLowerCase()
  const rows = snapshot.runs.filter((run) => {
    if (!matchesFilter(run)) return false
    if (!query) return true
    return `${run.title} ${run.author ?? ''}`.toLowerCase().includes(query)
  })
  // Сервер отдаёт список от новых к старым; обратный порядок — это порядок,
  // в котором книги ставились, и по нему видно, докуда дошла очередь.
  return newestFirst ? rows : [...rows].reverse()
}

function renderFilters() {
  elements.filters.innerHTML = FILTERS.map((entry) => {
    const active = entry.id === filter ? ' active' : ''
    return `<button class="chip-button${active}" type="button" data-filter="${entry.id}">${entry.label}</button>`
  }).join('')
}

function render() {
  const rows = visibleRuns()
  const total = snapshot.runs.length
  const published = snapshot.runs.filter((run) => state(run).tone === 'ok').length
  const broken = snapshot.runs.filter((run) => run.status === 'failed' || run.failedJobs > 0).length
  elements['runs-note'].textContent = total
    ? `${total} книг запущено · ${published} готовы · ${broken} с ошибками`
      + (rows.length === total ? '' : ` · показано ${rows.length}`)
    : 'Ни одного прогона.'
  elements['runs-empty'].hidden = rows.length > 0
  // Номер — позиция в полном списке запусков, а не в отфильтрованном: по нему
  // книгу находят в плане, и он не должен прыгать от смены фильтра.
  const position = new Map(snapshot.runs.map((run, index) => [run.runId, total - index]))
  elements['runs-body'].innerHTML = rows.map((run) => {
    const { tone, text } = state(run)
    const codes = run.failedCodes.length
      ? run.failedCodes.map((code) => `<span class="chip bad">${escapeHtml(code)} <span class="n">${run.failedJobs}</span></span>`).join('')
      : '<span class="muted">—</span>'
    return `<tr class="${tone === 'bad' ? 'row-bad' : ''}">
      <td class="col-num muted">${position.get(run.runId) ?? ''}</td>
      <td>
        <a class="book-link" href="./?book=${encodeURIComponent(run.bookEditionId)}">${escapeHtml(run.title)}</a>
        <span class="byline">${escapeHtml(run.author || '—')}${run.runSequence > 1 ? ` · прогон #${run.runSequence}` : ''}</span>
      </td>
      <td><span class="started">${escapeHtml(startedAt(run.startedAt))}</span><span class="byline">${escapeHtml(age(run.startedAt))}</span></td>
      <td><span class="chip ${tone}">${escapeHtml(text)}</span></td>
      <td class="col-num">${run.windows.ready}<span class="muted"> / ${run.windows.total}</span></td>
      <td class="col-num">${run.cards}</td>
      <td class="col-num">${run.publications}</td>
      <td class="col-codes">${codes}</td>
    </tr>`
  }).join('')
}

function setLive(status, text) {
  liveState.classList.toggle('connected', status === 'connected')
  liveState.classList.toggle('error', status === 'error')
  elements['live-label'].textContent = text
}

let timer = null

async function refresh() {
  try {
    const response = await fetch('./api/cards-runs', { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    snapshot = await response.json()
    render()
    setLive('connected', `Обновлено ${new Date(snapshot.generatedAt).toLocaleTimeString('ru-RU')}`)
  } catch (error) {
    setLive('error', `Нет данных: ${error.message}`)
  }
}

function schedule() {
  clearInterval(timer)
  if (!elements['auto-refresh'].checked) return
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void refresh()
  }, REFRESH_MS)
}

elements.filters.addEventListener('click', (event) => {
  const target = event.target.closest('[data-filter]')
  if (!target) return
  filter = target.dataset.filter
  renderFilters()
  render()
})
elements.search.addEventListener('input', render)
elements['sort-toggle'].addEventListener('click', () => {
  newestFirst = !newestFirst
  elements['sort-toggle'].textContent = newestFirst ? 'Сначала новые' : 'Сначала старые'
  render()
})
elements['auto-refresh'].addEventListener('change', () => {
  schedule()
  if (elements['auto-refresh'].checked) void refresh()
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && elements['auto-refresh'].checked) void refresh()
})

renderFilters()
void refresh()
schedule()

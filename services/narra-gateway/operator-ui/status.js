/**
 * Дашборд прогресса: кто из воркеров жив и что происходит с книгами.
 *
 * Страница намеренно ничего не меняет — только читает `/operator/api/progress`.
 * Во время раскатки оператору нужно понять состояние, а не вмешаться в него;
 * кнопки перезапуска живут на странице книги, где видно, что именно ломается.
 */

const REFRESH_MS = 5_000
const SLOW_LEASE_MS = 90_000

const stageLabels = {
  prepare: 'Подготовка',
  scan: 'Сканирование',
  resolve: 'Связи сущностей',
  synthesize: 'Синтез',
  validate: 'Проверка',
  publish: 'Публикация'
}
const jobLabels = {
  book_markup: 'Разметка',
  book_identity: 'Идентичность',
  catalog_cover: 'Обложка',
  scene_image: 'Сцена',
  character_bundle: 'Бандл',
  character_portrait: 'Портрет',
  character_audio: 'Аудио',
  character_animation: 'Анимация',
  character_card: 'Карточка',
  roster_confirm: 'Состав'
}
const statusLabels = {
  queued: 'в очереди', running: 'в работе', ready: 'готово', failed: 'ошибка', cancelled: 'отменено'
}
const statusTone = { ready: 'ok', running: '', queued: '', failed: 'bad', cancelled: 'warn' }

const elements = Object.fromEntries([
  'worker-grid', 'workers-note', 'running-list', 'running-note',
  'book-grid', 'books-note', 'live-label', 'auto-refresh'
].map((id) => [id, document.getElementById(id)]))
const liveState = document.querySelector('.live-state')

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character])
}

function label(map, value) {
  return map[value] ?? String(value ?? '')
}

function age(ms) {
  if (ms == null) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} с`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} мин`
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

function since(value) {
  if (!value) return '—'
  return age(Date.now() - new Date(value).getTime())
}

function tallyChips(entries) {
  if (!entries.length) return '<span class="muted">нет</span>'
  return entries.map((entry) => {
    const tone = statusTone[entry.status] ?? ''
    const name = label({ ...stageLabels, ...jobLabels }, entry.name ?? entry.tier)
    return `<span class="chip ${tone}">${escapeHtml(name)} · ${escapeHtml(label(statusLabels, entry.status))}
      <span class="n">${entry.count}</span></span>`
  }).join('')
}

function renderWorkers(snapshot) {
  const groups = snapshot.workers ?? []
  if (!groups.length) {
    elements['worker-grid'].innerHTML = '<p class="empty-note">Ни один воркер не отметился.</p>'
    return
  }
  const builds = new Set(groups.flatMap((group) => group.builds ?? []))
  elements['workers-note'].textContent = builds.size > 1
    ? `Живые воркеры на разных сборках: ${[...builds].map((build) => build.slice(0, 8)).join(', ')}`
    : `Живой — отметился меньше ${snapshot.staleWorkerSeconds} с назад. Погасшие строки`
      + ` хранятся ${snapshot.workerRetentionHours} ч: после деплоя старый контейнер оставляет свою.`
  elements['worker-grid'].innerHTML = groups.map((group) => {
    const tone = group.alive === 0 ? 'down' : ''
    return `<article class="worker-card ${tone}">
      <div class="worker-name">${escapeHtml(group.workerType)}</div>
      <div class="worker-count">${group.alive}<span class="of"> живых</span></div>
      <div class="worker-meta">
        <span>${group.states.length ? `состояние: ${escapeHtml(group.states.join(', '))}` : 'не отвечает'}</span>
        <span>отметка: ${escapeHtml(since(group.lastSeenAt))} назад</span>
        ${group.stale ? `<span>погасших контейнеров: ${group.stale}</span>` : ''}
        <code>${escapeHtml((group.builds ?? []).map((build) => build.slice(0, 12)).join(' '))}</code>
      </div>
    </article>`
  }).join('')
}

function renderRunning(snapshot) {
  const rows = snapshot.running ?? []
  elements['running-note'].textContent = rows.length
    ? `${rows.length} заданий держат аренду`
    : 'Ни одно задание не занято — очередь пуста или воркеры простаивают.'
  if (!rows.length) {
    elements['running-list'].innerHTML = '<p class="empty-note">Пусто.</p>'
    return
  }
  elements['running-list'].innerHTML = rows.map((row) => {
    const what = row.kind === 'analysis'
      ? label(stageLabels, row.label)
      : label(jobLabels, row.label)
    const character = row.characterKey ? ` · ${escapeHtml(row.characterKey)}` : ''
    return `<div class="running-row ${row.leaseAgeMs > SLOW_LEASE_MS ? 'slow' : ''}">
      <span class="kind muted">${row.kind === 'analysis' ? 'анализ' : 'генерация'}</span>
      <span class="what">${escapeHtml(what)}${character}</span>
      <span class="book">${escapeHtml(row.bookTitle ?? '')}</span>
      <span class="age">${escapeHtml(age(row.leaseAgeMs))}</span>
    </div>`
  }).join('')
}

function renderBooks(snapshot) {
  const books = snapshot.books ?? []
  const active = books.filter((book) => book.status === 'running' || book.status === 'queued')
  elements['books-note'].textContent = books.length
    ? `${active.length} в работе, ${books.length - active.length} завершены недавно`
    : 'Ни одного прогона.'
  if (!books.length) {
    elements['book-grid'].innerHTML = '<p class="empty-note">Пусто.</p>'
    return
  }
  elements['book-grid'].innerHTML = books.map((book) => {
    const failed = [...book.stages, ...book.runJobs].some((entry) => entry.status === 'failed')
    const tone = book.status === 'failed' || failed ? 'broken' : active.includes(book) ? 'active' : ''
    const rosterTotal = book.roster.reduce((sum, entry) => sum + entry.count, 0)
    const cardsBlock = book.pipelineId === 'cards'
      ? `<div class="book-block">
           <h4>Карточки</h4>
           <div class="chip-row">
             <span class="chip ${rosterTotal ? 'ok' : ''}">Состав <span class="n">${rosterTotal}</span></span>
             <span class="chip ${book.cards.published ? 'ok' : ''}">Опубликовано <span class="n">${book.cards.published}</span></span>
             ${book.cards.lastWindowIndex == null
               ? ''
               : `<span class="chip">Окно <span class="n">${book.cards.lastWindowIndex}</span></span>`}
           </div>
         </div>`
      : ''
    return `<article class="book-card ${tone}">
      <div>
        <h3>${escapeHtml(book.title)}</h3>
        <p class="byline">${escapeHtml(book.author || '—')} · прогон #${book.runSequence} · ${escapeHtml(since(book.updatedAt))} назад</p>
      </div>
      <div class="chip-row">
        <span class="chip pipeline-${escapeHtml(book.pipelineId)}">${escapeHtml(book.pipelineId)}</span>
        <span class="chip ${statusTone[book.status] ?? ''}">${escapeHtml(label(stageLabels, book.stage))} · ${escapeHtml(label(statusLabels, book.status))}</span>
      </div>
      <div class="book-block">
        <h4>Стадии</h4>
        <div class="chip-row">${tallyChips(book.stages)}</div>
      </div>
      ${cardsBlock}
      <div class="book-block">
        <h4>Задания прогона</h4>
        <div class="chip-row">${tallyChips(book.runJobs)}</div>
      </div>
      <div class="book-block">
        <h4>Медиа книги</h4>
        <div class="chip-row">${tallyChips(book.editionJobs)}</div>
      </div>
    </article>`
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
    const response = await fetch('./api/progress', { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const snapshot = await response.json()
    renderWorkers(snapshot)
    renderRunning(snapshot)
    renderBooks(snapshot)
    setLive('connected', `Обновлено ${new Date(snapshot.generatedAt).toLocaleTimeString('ru-RU')}`)
  } catch (error) {
    setLive('error', `Нет данных: ${error.message}`)
  }
}

function schedule() {
  clearInterval(timer)
  if (!elements['auto-refresh'].checked) return
  timer = setInterval(() => {
    // Вкладка в фоне не опрашивает: дашборд держат открытым часами, и фоновый
    // опрос раз в пять секунд — это нагрузка на базу без единого зрителя.
    if (document.visibilityState === 'visible') void refresh()
  }, REFRESH_MS)
}

elements['auto-refresh'].addEventListener('change', () => {
  schedule()
  if (elements['auto-refresh'].checked) void refresh()
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && elements['auto-refresh'].checked) void refresh()
})

void refresh()
schedule()

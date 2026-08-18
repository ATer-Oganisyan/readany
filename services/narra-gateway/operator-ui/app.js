const stageOrder = ['prepare', 'scan', 'resolve', 'synthesize', 'validate', 'publish']
const stageLabels = {
  prepare: 'Подготовка',
  scan: 'Сканирование',
  resolve: 'Связи сущностей',
  synthesize: 'Синтез профилей',
  validate: 'Проверка',
  publish: 'Публикация',
  not_started: 'Не запущено'
}
const statusLabels = {
  queued: 'В очереди', running: 'В работе', ready: 'Готово', failed: 'Ошибка',
  cancelled: 'Отменено', published: 'Опубликовано', not_started: 'Не запущено',
  not_queued: 'Не поставлено', prepared: 'Подготовлено', suspicious: 'Проверить'
}
const phaseLabels = { observed: 'Обнаружен', resolved: 'Подтверждён', published: 'Опубликован' }
const mediaLabels = {
  primary_portrait: 'Портрет', greeting_audio: 'Аудио', idle_animation: 'Анимация'
}

const state = {
  books: [],
  selectedId: null,
  detail: null,
  activeTab: 'overview',
  json: null,
  operations: null,
  monitorBookId: null,
  refreshing: false,
  search: ''
}

const elements = Object.fromEntries([
  'book-list', 'book-search', 'summary-strip', 'empty-state', 'book-panel', 'book-title',
  'book-author', 'book-meta', 'heading-percent', 'heading-status', 'stage-grid', 'metric-grid',
  'character-grid', 'character-count', 'refreshed-at', 'operation-list', 'json-view', 'toast',
  'upload-form', 'upload-steps', 'upload-live-detail', 'live-label', 'restart-book',
  'quality-alert'
].map((id) => [id, document.getElementById(id)]))

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character])
}

function formatDate(value, { timeOnly = false } = {}) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('ru-RU', timeOnly
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }
  ).format(date)
}

function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (value < 1024) return `${value} Б`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`
  return `${(value / 1024 / 1024).toFixed(1)} МБ`
}

async function api(path, options = {}) {
  const response = await fetch(`./api/${path}`, {
    cache: 'no-store',
    ...options,
    headers: { accept: 'application/json', ...(options.headers || {}) }
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body
}

function connection(status, text) {
  const container = elements['live-label'].parentElement
  container.classList.toggle('connected', status === 'connected')
  container.classList.toggle('error', status === 'error')
  elements['live-label'].textContent = text
}

function toast(message, error = false) {
  const node = elements.toast
  node.textContent = message
  node.classList.toggle('error', error)
  node.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { node.hidden = true }, 4200)
}

function renderBookList() {
  const search = state.search.toLocaleLowerCase('ru')
  const books = state.books.filter((book) =>
    `${book.title} ${book.author} ${book.catalogKey || ''}`.toLocaleLowerCase('ru').includes(search)
  )
  const active = state.books.filter((book) => ['queued', 'running'].includes(book.progress.status)).length
  const failed = state.books.filter((book) => book.progress.status === 'failed').length
  const suspicious = state.books.filter((book) =>
    book.quality?.characterAppearance?.status === 'suspicious'
  ).length
  elements['summary-strip'].innerHTML = `<span><strong>${state.books.length}</strong> книг</span><span><strong>${active}</strong> в работе</span>${failed ? `<span><strong>${failed}</strong> ошибок</span>` : ''}${suspicious ? `<span class="quality-count"><strong>${suspicious}</strong> проверить</span>` : ''}`
  elements['book-list'].innerHTML = books.length
      ? books.map((book) => {
        const percent = Number(book.progress?.percent || 0)
        const qualitySuspicious = book.quality?.characterAppearance?.status === 'suspicious'
        const rowStatus = qualitySuspicious ? 'suspicious' : book.progress.status
        return `<button type="button" class="book-row ${book.id === state.selectedId ? 'active' : ''}" data-book-id="${escapeHtml(book.id)}">
          <span class="book-row-main"><span><span class="book-row-title">${escapeHtml(book.title)}</span><span class="book-row-author">${escapeHtml(book.author || 'Автор не указан')}</span></span><span class="status ${escapeHtml(rowStatus)}">${escapeHtml(statusLabels[rowStatus] || rowStatus)}</span></span>
          <span class="progress-track"><span style="width:${percent}%"></span></span>
          <span class="book-row-state"><span>${escapeHtml(stageLabels[book.progress.stage] || book.progress.stage)}</span><span>${percent}% · ${Number(book.findings?.publishedCharacters || book.findings?.characters || 0)} перс.</span></span>
        </button>`
      }).join('')
    : '<div class="placeholder-card">Книги не найдены</div>'
}

function stageState(detail, stage, index) {
  const run = detail.run
  const counts = run?.jobs?.[stage]
  if (!run) return { status: 'not_started', detail: '—' }
  const current = stageOrder.indexOf(run.stage)
  if (run.status === 'ready' || index < current) {
    return { status: 'ready', detail: counts?.total ? `${counts.ready}/${counts.total}` : 'Завершено' }
  }
  if (index > current) return { status: 'not_started', detail: 'Ожидает' }
  if (run.status === 'failed') return { status: 'failed', detail: run.lastErrorCode || 'Ошибка' }
  if (!counts?.total) return { status: run.status, detail: statusLabels[run.status] || run.status }
  return {
    status: counts.failed ? 'failed' : counts.running ? 'running' : counts.queued ? 'queued' : 'ready',
    detail: `${counts.ready}/${counts.total} готово${counts.failed ? ` · ${counts.failed} ошибок` : ''}`
  }
}

function mediaStatus(character, assetType) {
  const asset = character.media?.assets?.[assetType]
  if (asset) return asset.status || 'ready'
  return character.media?.status || 'not_queued'
}

function renderDetail(detail) {
  state.detail = detail
  const book = detail.book
  const progress = book.progress || { percent: 0, stage: 'not_started', status: 'not_started' }
  elements['empty-state'].hidden = true
  elements['book-panel'].hidden = false
  elements['book-title'].textContent = book.title
  elements['book-author'].textContent = book.author || 'Автор не указан'
  elements['book-meta'].textContent = `${book.scope === 'catalog' ? 'Каталог' : 'Личная'} · ${book.format.toUpperCase()} · ${book.catalogKey || book.id}`
  elements['heading-percent'].textContent = `${progress.percent}%`
  elements['heading-status'].textContent = `${stageLabels[progress.stage] || progress.stage} · ${statusLabels[progress.status] || progress.status}`
  elements['restart-book'].hidden = false
  document.getElementById('review-book').href = `./review?book=${encodeURIComponent(book.id)}`
  elements['restart-book'].disabled = ['queued', 'running'].includes(progress.status)
  elements['restart-book'].textContent = elements['restart-book'].disabled
    ? 'v3 выполняется'
    : 'Перезапустить v3'
  elements['refreshed-at'].textContent = `Обновлено ${formatDate(detail.refreshedAt, { timeOnly: true })}`

  const appearanceAudit = book.quality?.characterAppearance
  elements['quality-alert'].hidden = !appearanceAudit
  if (appearanceAudit) {
    const suspicious = appearanceAudit.status === 'suspicious'
    const percent = Math.round(Number(appearanceAudit.earlyCharacterFraction || 0) * 100)
    elements['quality-alert'].className = `quality-alert ${suspicious ? 'suspicious' : 'clear'}`
    elements['quality-alert'].innerHTML = suspicious
      ? `<strong>Подозрительно раннее открытие персонажей</strong><span>${appearanceAudit.earlyCharacterCount} из ${appearanceAudit.characterCount} героев (${percent}%) получили первое появление до позиции ${appearanceAudit.earlyBoundaryTextOffset}. Новую публикацию нужно проверить и переразметить.</span>`
      : `<strong>Координаты появления прошли аудит</strong><span>Массового кластера персонажей в начале книги не найдено.</span>`
  }

  elements['stage-grid'].innerHTML = stageOrder.map((stage, index) => {
    const value = stageState(detail, stage, index)
    const active = detail.run?.stage === stage && detail.run?.status !== 'ready'
    return `<article class="stage-card ${escapeHtml(value.status)} ${active ? 'active' : ''}">
      <span class="stage-index">${value.status === 'ready' ? '✓' : index + 1}</span>
      <div><div class="stage-name">${escapeHtml(stageLabels[stage])}</div><div class="stage-detail">${escapeHtml(value.detail)}</div></div>
    </article>`
  }).join('')

  const findings = book.findings || {}
  const media = book.media || {}
  elements['metric-grid'].innerHTML = [
    [findings.observations || 0, 'Наблюдений'],
    [findings.characters || 0, 'Подтверждённых персонажей'],
    [findings.publishedCharacters || 0, 'В опубликованном JSON'],
    [`${media.ready || 0}/${media.total || 0}`, 'Готовых медиапакетов']
  ].map(([value, label]) => `<article class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`).join('')

  const characters = detail.characters || []
  elements['character-count'].textContent = `${characters.length} найдено`
  elements['character-grid'].innerHTML = characters.length
    ? characters.map((character) => `<article class="character-card">
        <div class="character-head"><div><div class="character-name">${escapeHtml(character.name)}</div><div class="character-phase">${escapeHtml(phaseLabels[character.phase] || character.phase)}</div></div><span class="status ${escapeHtml(character.media?.status)}">${escapeHtml(statusLabels[character.media?.status] || character.media?.status)}</span></div>
        <div class="media-row">${Object.entries(mediaLabels).map(([type, label]) => {
          const status = mediaStatus(character, type)
          return `<span class="media-chip ${escapeHtml(status)}">${escapeHtml(label)}<br>${escapeHtml(statusLabels[status] || status)}</span>`
        }).join('')}</div>
      </article>`).join('')
    : `<div class="placeholder-card">Персонажи ещё не появились. Во время scan/resolve здесь будут видны кандидаты, затем подтверждённые профили.</div>`
  renderUploadLive(detail)
}

function renderUploadLive(detail) {
  if (!detail || state.monitorBookId !== detail.book.id) return
  const progress = detail.book.progress
  elements['upload-live-detail'].innerHTML = `<div class="mini-progress"><strong>${escapeHtml(detail.book.title)}</strong><strong>${progress.percent}%</strong></div><div class="progress-track"><span style="width:${progress.percent}%"></span></div><p class="muted">${escapeHtml(stageLabels[progress.stage] || progress.stage)} · ${detail.characters.length} персонажей · ${detail.book.media.ready}/${detail.book.media.total} медиапакетов</p>`
}

function renderOperations(operations) {
  state.operations = operations
  elements['operation-list'].innerHTML = operations.length
    ? operations.map((operation) => `<article class="operation">
        <time class="operation-time">${escapeHtml(formatDate(operation.at))}</time>
        <span class="operation-kind">${escapeHtml(operation.kind)}</span>
        <div class="operation-main"><strong>${escapeHtml(stageLabels[operation.stage] || operation.stage || operation.kind)}</strong><small>${escapeHtml(operation.shardKey || operation.id)}${operation.worker ? ` · ${escapeHtml(operation.worker)}` : ''}${operation.error ? ` · ${escapeHtml(operation.error)}` : ''}</small></div>
        <span class="status ${escapeHtml(operation.status)}">${escapeHtml(statusLabels[operation.status] || operation.status)}</span>
        <details><summary>Данные операции</summary><pre>${escapeHtml(JSON.stringify(operation.details || {}, null, 2))}</pre></details>
      </article>`).join('')
    : '<div class="placeholder-card">Операций пока нет</div>'
}

function renderJson(value) {
  state.json = value
  elements['json-view'].textContent = JSON.stringify(value, null, 2)
}

async function selectBook(bookId) {
  state.selectedId = bookId
  state.json = null
  state.operations = null
  renderBookList()
  await refreshSelected(true)
}

async function refreshBooks() {
  const result = await api('books')
  state.books = result.books
  renderBookList()
}

async function refreshSelected(forceExtra = false) {
  if (!state.selectedId) return
  const detail = await api(`books/${state.selectedId}`)
  renderDetail(detail)
  if (state.activeTab === 'operations') {
    renderOperations((await api(`books/${state.selectedId}/operations`)).operations)
  }
  if (state.activeTab === 'json') {
    renderJson(await api(`books/${state.selectedId}/json`))
  }
}

async function refresh() {
  if (state.refreshing || document.hidden) return
  state.refreshing = true
  try {
    await refreshBooks()
    await refreshSelected(false)
    connection('connected', `Live · ${formatDate(new Date(), { timeOnly: true })}`)
  } catch (error) {
    connection('error', 'Нет связи')
    console.error(error)
  } finally {
    state.refreshing = false
  }
}

async function setTab(tab) {
  state.activeTab = tab
  document.querySelectorAll('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab))
  document.querySelectorAll('.tab-panel').forEach((panel) => { panel.hidden = panel.id !== `tab-${tab}` })
  if (tab === 'operations' && state.selectedId) {
    renderOperations((await api(`books/${state.selectedId}/operations`)).operations)
  }
  if (tab === 'json' && state.selectedId) renderJson(await api(`books/${state.selectedId}/json`))
}

function openUpload() {
  elements['empty-state'].hidden = true
  elements['book-panel'].hidden = false
  if (!state.selectedId) {
    elements['restart-book'].hidden = true
    elements['book-title'].textContent = 'Новая книга'
    elements['book-author'].textContent = 'Загрузите файл — v3 запустится автоматически'
    elements['book-meta'].textContent = 'Каталог'
    elements['heading-percent'].textContent = '—'
    elements['heading-status'].textContent = 'Ожидает загрузки'
  }
  void setTab('upload')
}

function uploadStep(id, text, status = 'running') {
  let node = document.querySelector(`[data-upload-step="${id}"]`)
  if (!node) {
    node = document.createElement('li')
    node.dataset.uploadStep = id
    elements['upload-steps'].append(node)
  }
  node.className = `upload-step ${status}`
  node.textContent = text
}

async function sha256(file) {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function uploadRaw(path, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `./api/${path}`)
    request.responseType = 'json'
    request.setRequestHeader('Content-Type', contentType)
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100))
    })
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) resolve(request.response || {})
      else reject(new Error(request.response?.error || `HTTP ${request.status}`))
    })
    request.addEventListener('error', () => reject(new Error('Сеть недоступна')))
    request.send(file)
  })
}

const transliteration = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' }
function catalogKey(filename) {
  const withoutExtension = filename.replace(/\.[^.]+$/, '').toLocaleLowerCase('ru')
  const latin = [...withoutExtension].map((letter) => transliteration[letter] ?? letter).join('')
  const normalized = latin.replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+|[-.]+$/g, '').slice(0, 128)
  return normalized || `book-${Date.now()}`
}

elements['upload-form'].elements.book.addEventListener('change', (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  const title = elements['upload-form'].elements.title
  const key = elements['upload-form'].elements.catalogKey
  if (!title.value) title.value = file.name.replace(/\.[^.]+$/, '')
  if (!key.value) key.value = catalogKey(file.name)
})

elements['upload-form'].addEventListener('submit', async (event) => {
  event.preventDefault()
  const form = event.currentTarget
  const button = form.querySelector('button[type="submit"]')
  const book = form.elements.book.files?.[0]
  const cover = form.elements.cover.files?.[0]
  if (!book) return
  const format = book.name.split('.').pop()?.toLowerCase()
  const mimeTypes = { epub: 'application/epub+zip', fb2: 'application/x-fictionbook+xml', txt: 'text/plain', pdf: 'application/pdf' }
  if (!mimeTypes[format]) return toast('Поддерживаются EPUB, FB2, TXT и PDF', true)
  button.disabled = true
  elements['upload-steps'].replaceChildren()
  elements['upload-live-detail'].textContent = ''
  try {
    uploadStep('hash', 'Считаю SHA-256…')
    const contentSha256 = await sha256(book)
    uploadStep('hash', `SHA-256 готов · ${formatBytes(book.size)}`, 'ready')

    uploadStep('prepare', 'Создаю запись книги…')
    const prepared = await api('uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        catalog_key: form.elements.catalogKey.value,
        content_sha256: contentSha256,
        title: form.elements.title.value,
        author: form.elements.author.value,
        format,
        byte_size: book.size
      })
    })
    uploadStep('prepare', `Книга создана · ${prepared.bookEditionId}`, 'ready')
    state.monitorBookId = prepared.bookEditionId

    if (prepared.uploadRequired) {
      uploadStep('source', 'Загружаю файл · 0%')
      await uploadRaw(`uploads/${prepared.bookEditionId}/content`, book, mimeTypes[format], (percent) => {
        uploadStep('source', `Загружаю файл · ${percent}%`)
      })
      uploadStep('source', 'Файл проверен и сохранён', 'ready')
      uploadStep('queue', 'Ставлю v3-анализ в очередь…')
      await api(`uploads/${prepared.bookEditionId}/complete`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
      })
      uploadStep('queue', 'Единый v3 pipeline запущен', 'ready')
    } else {
      uploadStep('source', 'Этот файл уже загружен', 'ready')
      uploadStep('queue', 'Существующий v3 run продолжен', 'ready')
    }

    if (cover) {
      uploadStep('cover-hash', 'Готовлю обложку…')
      const coverExtension = cover.name.split('.').pop()?.toLowerCase()
      const coverMimeType = cover.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[coverExtension]
      if (!coverMimeType) throw new Error('Обложка должна быть JPEG, PNG или WebP')
      const coverPrepared = await api(`uploads/${prepared.bookEditionId}/cover`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          content_sha256: await sha256(cover), mime_type: coverMimeType, byte_size: cover.size
        })
      })
      if (coverPrepared.uploadRequired) {
        await uploadRaw(`uploads/${prepared.bookEditionId}/cover/content`, cover, coverMimeType, (percent) => {
          uploadStep('cover-hash', `Загружаю обложку · ${percent}%`)
        })
        await api(`uploads/${prepared.bookEditionId}/cover/complete`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
        })
      }
      uploadStep('cover-hash', 'Обложка сохранена', 'ready')
    }
    uploadStep('live', 'Live-мониторинг анализа включён', 'running')
    state.selectedId = prepared.bookEditionId
    await refresh()
    toast('Книга загружена, v3-анализ запущен')
  } catch (error) {
    uploadStep('error', error.message, 'failed')
    toast(error.message, true)
  } finally {
    button.disabled = false
  }
})

elements['book-list'].addEventListener('click', (event) => {
  const row = event.target.closest('[data-book-id]')
  if (row) void selectBook(row.dataset.bookId).catch((error) => toast(error.message, true))
})
elements['book-search'].addEventListener('input', (event) => { state.search = event.target.value; renderBookList() })
document.getElementById('open-upload').addEventListener('click', openUpload)
elements['restart-book'].addEventListener('click', async () => {
  if (!state.selectedId || elements['restart-book'].disabled) return
  const title = state.detail?.book?.title || 'эту книгу'
  const confirmed = globalThis.confirm(
    `Перезапустить v3-разметку для «${title}»? Текущий опубликованный результат останется доступен до успешного завершения нового.`
  )
  if (!confirmed) return
  elements['restart-book'].disabled = true
  elements['restart-book'].textContent = 'Запускаю…'
  try {
    const result = await api(`books/${state.selectedId}/restart`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    })
    toast(result.created ? `Запущена v3-разметка №${result.run.runSequence}` : 'v3-разметка уже выполняется')
    await refresh()
  } catch (error) {
    toast(error.message, true)
    await refresh()
  }
})
document.querySelector('.tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]')
  if (tab) void setTab(tab.dataset.tab).catch((error) => toast(error.message, true))
})
document.getElementById('refresh-operations').addEventListener('click', async () => {
  if (!state.selectedId) return
  try { renderOperations((await api(`books/${state.selectedId}/operations`)).operations) }
  catch (error) { toast(error.message, true) }
})
document.getElementById('copy-json').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(elements['json-view'].textContent); toast('JSON скопирован') }
  catch { toast('Не удалось скопировать JSON', true) }
})

void refresh()
setInterval(() => void refresh(), 2_000)

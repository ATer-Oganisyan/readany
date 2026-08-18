const state = { payload: null, markup: null, evidence: new Map(), selectedKey: null, search: '' }

const elements = Object.fromEntries([
  'review-intro', 'review-workspace', 'review-version', 'review-title', 'review-meta',
  'diagnostic-grid', 'character-search', 'character-list', 'character-review', 'json-file',
  'drop-zone', 'toast'
].map((id) => [id, document.getElementById(id)]))

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character])
}

function toast(message, error = false) {
  elements.toast.textContent = message
  elements.toast.classList.toggle('error', error)
  elements.toast.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { elements.toast.hidden = true }, 4200)
}

function claimValue(claim) {
  if (typeof claim === 'string') return claim.trim()
  if (claim && typeof claim.value === 'string') return claim.value.trim()
  return ''
}

function claimList(value) {
  if (Array.isArray(value)) return value.filter((item) => claimValue(item))
  return claimValue(value) ? [value] : []
}

function characterTraits(character) {
  return claimList(character.traits?.length ? character.traits : character.personality)
}

function characterData(value) {
  const data = value?.data && typeof value.data === 'object' ? value.data : value
  return { ...data, characterKey: data.characterKey || value?.characterKey }
}

function unpack(input) {
  const markup = input?.publication?.data?.markup || input?.data?.markup || input?.markup ||
    (Array.isArray(input?.characters) ? input : null)
  if (!markup || !Array.isArray(markup.characters)) {
    throw new Error('Не найден массив characters из book-markup-v3')
  }
  const evidence = Array.isArray(input?.evidence)
    ? input.evidence
    : Array.isArray(input?.publication?.evidence) ? input.publication.evidence : []
  return { markup: { ...markup, characters: markup.characters.map(characterData) }, evidence }
}

function evidenceIds(claim) {
  return Array.isArray(claim?.evidenceIds) ? claim.evidenceIds : []
}

function allCharacterEvidenceIds(character) {
  const ids = new Set(character.identityEvidenceIds || [])
  for (const field of ['role', 'age', 'gender', 'description', 'speechStyle']) {
    for (const id of evidenceIds(character[field])) ids.add(id)
  }
  for (const field of ['traits', 'personality', 'appearance', 'speechExamples']) {
    for (const claim of claimList(character[field])) {
      for (const id of evidenceIds(claim)) ids.add(id)
    }
  }
  return [...ids]
}

function missingProfileParts(character) {
  return [
    !claimValue(character.description) && 'описание',
    !characterTraits(character).length && 'характер',
    !claimList(character.appearance).length && 'внешность'
  ].filter(Boolean)
}

function renderDiagnostics() {
  const characters = state.markup.characters
  const missingTraits = characters.filter((item) => !characterTraits(item).length).length
  const missingDescription = characters.filter((item) => !claimValue(item.description)).length
  const missingAppearance = characters.filter((item) => !claimList(item.appearance).length).length
  const usedEvidenceIds = new Set(characters.flatMap(allCharacterEvidenceIds))
  const missingEvidence = [...usedEvidenceIds].filter((id) => !state.evidence.has(id)).length
  const values = [
    [characters.length, 'персонажей', false],
    [missingTraits, 'без характера', missingTraits > 0],
    [missingDescription, 'без описания', missingDescription > 0],
    [missingAppearance, 'без внешности', missingAppearance > 0],
    [missingEvidence, 'evidence без цитаты', missingEvidence > 0]
  ]
  elements['diagnostic-grid'].style.gridTemplateColumns = `repeat(${values.length}, minmax(110px, 1fr))`
  elements['diagnostic-grid'].innerHTML = values.map(([value, label, warning]) =>
    `<article class="diagnostic ${warning ? 'warning' : ''}"><strong>${value}</strong><span>${escapeHtml(label)}</span></article>`
  ).join('')
}

function renderCharacterList() {
  const query = state.search.toLocaleLowerCase('ru')
  const characters = state.markup.characters.filter((character) =>
    `${character.name || ''} ${character.fullName || ''} ${(character.aliases || []).join(' ')}`
      .toLocaleLowerCase('ru').includes(query)
  )
  elements['character-list'].innerHTML = characters.length
    ? characters.map((character) => {
        const key = character.characterKey || character.name
        const missing = missingProfileParts(character)
        return `<button type="button" class="character-index-row ${key === state.selectedKey ? 'active' : ''}" data-character-key="${escapeHtml(key)}">
          <strong>${missing.length ? '<span class="warning-dot" aria-hidden="true"></span>' : ''}${escapeHtml(character.name || key)}</strong>
          <span>${escapeHtml(missing.length ? `Нет: ${missing.join(', ')}` : character.fullName || 'Профиль заполнен')}</span>
        </button>`
      }).join('')
    : '<div class="placeholder-card">Персонажи не найдены</div>'
}

function renderEvidence(ids) {
  if (!ids.length) return ''
  return `<div class="evidence-list">${ids.map((id) => {
    const value = state.evidence.get(id)
    if (!value) return `<div class="evidence missing"><blockquote>Цитата не приложена к JSON</blockquote><footer>${escapeHtml(id)}</footer></div>`
    const confidence = Number.isFinite(Number(value.confidence))
      ? ` · уверенность ${Math.round(Number(value.confidence) * 100)}%`
      : ''
    return `<div class="evidence"><blockquote>«${escapeHtml(value.quote || value.evidenceQuote || value.fact)}»</blockquote><footer>${escapeHtml(value.type || value.observationType || 'evidence')} · ${Number(value.startOffset ?? value.evidenceStartOffset ?? 0)}–${Number(value.endOffset ?? value.evidenceEndOffset ?? 0)}${confidence}</footer></div>`
  }).join('')}</div>`
}

function renderClaim(claim) {
  const value = claimValue(claim)
  if (!value) return ''
  const confidence = Number.isFinite(Number(claim?.confidence))
    ? `${Math.round(Number(claim.confidence) * 100)}% уверенности`
    : 'без оценки уверенности'
  return `<article class="claim"><div class="claim-value">${escapeHtml(value)}</div><div class="claim-meta">${confidence} · ${evidenceIds(claim).length} evidence</div>${renderEvidence(evidenceIds(claim))}</article>`
}

function renderSection(title, claims, emptyLabel) {
  const values = claimList(claims)
  return `<section class="claim-section"><header><h3>${escapeHtml(title)}</h3><span>${values.length}</span></header>${values.length
    ? `<div class="claim-list">${values.map(renderClaim).join('')}</div>`
    : `<div class="empty-claim">${escapeHtml(emptyLabel)}</div>`}</section>`
}

function renderCharacter() {
  const character = state.markup.characters.find((item) =>
    (item.characterKey || item.name) === state.selectedKey
  )
  if (!character) {
    elements['character-review'].innerHTML = '<div class="placeholder-card">Выберите персонажа</div>'
    return
  }
  const identityIds = Array.isArray(character.identityEvidenceIds) ? character.identityEvidenceIds : []
  const aliases = Array.isArray(character.aliases) && character.aliases.length
    ? character.aliases.join(', ')
    : '—'
  const simpleClaims = [
    ['Роль', character.role], ['Возраст', character.age], ['Пол', character.gender]
  ].filter(([, value]) => claimValue(value))
  const allIds = allCharacterEvidenceIds(character)
  elements['character-review'].innerHTML = `
    <section class="profile-header">
      <div class="profile-title-row"><div><p class="eyebrow">${escapeHtml(character.characterKey || 'character')}</p><h2>${escapeHtml(character.name || character.fullName)}</h2><p class="muted">${escapeHtml(character.fullName || character.name || '')}</p></div><span class="status published">Опубликован</span></div>
      <div class="identity-grid">
        <div class="identity-item"><span>Алиасы</span><strong>${escapeHtml(aliases)}</strong></div>
        <div class="identity-item"><span>Первое появление</span><strong>${Number(character.firstAppearanceTextOffset || 0).toLocaleString('ru-RU')}</strong></div>
        <div class="identity-item"><span>Прогрев</span><strong>${Number(character.warmupTextOffset || 0).toLocaleString('ru-RU')}</strong></div>
        <div class="identity-item"><span>Identity evidence</span><strong>${identityIds.length}</strong></div>
      </div>
      ${renderEvidence(identityIds)}
    </section>
    ${renderSection('Базовые факты', simpleClaims.map(([, value]) => value), 'Роль, возраст и пол не заполнены')}
    ${renderSection('Описание персонажа', character.description, 'Описание не заполнено')}
    ${renderSection('Характер', characterTraits(character), 'Характер не заполнен')}
    ${renderSection('Внешность', character.appearance, 'Внешность не заполнена')}
    ${renderSection('Манера речи', [character.speechStyle, ...(character.speechExamples || [])], 'Манера речи не заполнена')}
    <section class="claim-section all-evidence"><details><summary>Все доказательства персонажа (${allIds.length})</summary>${renderEvidence(allIds)}</details></section>`
}

function loadPayload(payload, label = 'JSON') {
  const { markup, evidence } = unpack(payload)
  state.payload = payload
  state.markup = markup
  state.evidence = new Map(evidence.map((item) => [item.id, item]))
  state.selectedKey = markup.characters[0]?.characterKey || markup.characters[0]?.name || null
  elements['review-intro'].hidden = true
  elements['review-workspace'].hidden = false
  elements['review-version'].textContent = `${markup.analysisVersion || 'book-markup-v3'} · schema ${markup.schemaVersion || 3}`
  elements['review-title'].textContent = payload?.book?.title || markup.title || label
  elements['review-meta'].textContent = [payload?.book?.author, `${Number(markup.textLength || 0).toLocaleString('ru-RU')} символов`, `${evidence.length} цитат`].filter(Boolean).join(' · ')
  renderDiagnostics()
  renderCharacterList()
  renderCharacter()
}

async function loadFile(file) {
  if (!file) return
  if (file.size > 50 * 1024 * 1024) throw new Error('JSON больше 50 МБ')
  loadPayload(JSON.parse(await file.text()), file.name)
}

async function loadSample() {
  const response = await fetch('./assets/sample-book-markup-v3.json', { cache: 'no-store' })
  if (!response.ok) throw new Error(`Пример недоступен: HTTP ${response.status}`)
  loadPayload(await response.json(), 'Демонстрационный результат')
}

async function loadBook(bookId) {
  const response = await fetch(`./api/books/${encodeURIComponent(bookId)}/json`, {
    cache: 'no-store', headers: { accept: 'application/json' }
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  loadPayload(body, body.book?.title || bookId)
}

elements['character-list'].addEventListener('click', (event) => {
  const row = event.target.closest('[data-character-key]')
  if (!row) return
  state.selectedKey = row.dataset.characterKey
  renderCharacterList()
  renderCharacter()
})
elements['character-search'].addEventListener('input', (event) => {
  state.search = event.target.value
  renderCharacterList()
})
elements['json-file'].addEventListener('change', (event) => {
  void loadFile(event.target.files?.[0]).catch((error) => toast(error.message, true))
})
document.getElementById('open-sample').addEventListener('click', () => {
  void loadSample().catch((error) => toast(error.message, true))
})
for (const type of ['dragenter', 'dragover']) {
  elements['drop-zone'].addEventListener(type, (event) => {
    event.preventDefault()
    elements['drop-zone'].classList.add('dragging')
  })
}
for (const type of ['dragleave', 'drop']) {
  elements['drop-zone'].addEventListener(type, (event) => {
    event.preventDefault()
    elements['drop-zone'].classList.remove('dragging')
  })
}
elements['drop-zone'].addEventListener('drop', (event) => {
  void loadFile(event.dataTransfer?.files?.[0]).catch((error) => toast(error.message, true))
})

const bookId = new URLSearchParams(location.search).get('book')
if (bookId) void loadBook(bookId).catch((error) => toast(error.message, true))

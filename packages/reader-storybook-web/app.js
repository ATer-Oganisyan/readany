import readerUrl from "../app-expo/assets/reader/reader.html?url";
import serifBoldUrl from "../deslop-primitives/fonts/SBSerifText-Bold.otf?url";
import serifRegularUrl from "../deslop-primitives/fonts/SBSerifText-Regular.otf?url";
import genreCoverBooks from "./genre-cover-books.json";
import sampleBook from "./sample-book.fb2?raw";

const STORIES = [
  {
    group: "Обложки",
    items: [
      ["genre-covers", "Жанровый пак", "OpenRouter · GPT Image 2 · манга и Ficbook включены"],
    ],
  },
  {
    group: "Чтение",
    items: [
      ["reading", "Базовая страница", "Production WebView без нативной оболочки"],
      ["scroll", "Скролл", "Непрерывный режим чтения"],
      ["large-text", "Крупный текст", "Масштабирование типографики и отступов"],
      ["dark", "Тёмная тема", "Цвета передаются в WebView из приложения"],
    ],
  },
  {
    group: "Закладка",
    items: [["bookmark-added", "Добавлено в закладки", "В момент достижения порога жеста — 60 px"]],
  },
  {
    group: "Работа с текстом",
    items: [
      ["selection", "Выделение", "Нативное браузерное выделение внутри книги"],
      ["search", "Результат поиска", "Поисковая подсветка foliate-js"],
      ["highlight", "Выделенный фрагмент", "Сохранённая аннотация в тексте"],
      ["note", "Заметка в тексте", "Аннотация с маркером заметки"],
      ["tts", "Озвучиваемый фрагмент", "Активная TTS-подсветка"],
      ["translation", "Перевод абзацев", "Перевод внедрён рядом с оригиналом"],
      ["footnote", "Сноска", "Внутренний WebView-поповер сноски"],
    ],
  },
  {
    group: "Системные состояния",
    items: [
      ["loading", "Загрузка", "Встроенный индикатор reader.html"],
      ["error", "Ошибка открытия", "Ошибка отображается самим WebView"],
    ],
  },
];

const STORY_MAP = new Map(
  STORIES.flatMap(({ group, items }) =>
    items.map(([id, title, description]) => [id, { id, title, description, group }]),
  ),
);

const navigation = document.querySelector("#story-navigation");
const frame = document.querySelector("#reader-frame");
const title = document.querySelector("#story-title");
const description = document.querySelector("#story-description");
const status = document.querySelector("#reader-status");
const previousPage = document.querySelector("#previous-page");
const nextPage = document.querySelector("#next-page");
const readerActions = document.querySelector(".reader-actions");
const previewStage = document.querySelector(".preview-stage");
const viewportLabel = document.querySelector(".viewport-label");
const coverGallery = document.querySelector("#genre-cover-gallery");

let activeStory = getStoryFromHash();
let currentRun = 0;
let storyApplied = false;

const bookmarkCopy = {
  added: "Добавлено в закладки",
};

function getStoryFromHash() {
  const id = decodeURIComponent(window.location.hash.slice(1));
  return STORY_MAP.get(id) ?? STORY_MAP.get("reading");
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function renderNavigation() {
  navigation.replaceChildren(
    ...STORIES.map(({ group, items }) => {
      const section = document.createElement("section");
      section.className = "story-group";
      const heading = document.createElement("h2");
      heading.textContent = group;
      section.append(heading);

      for (const [id, itemTitle] of items) {
        const button = document.createElement("button");
        button.className = "story-link";
        button.type = "button";
        button.textContent = itemTitle;
        button.dataset.story = id;
        button.setAttribute("aria-current", String(activeStory.id === id));
        button.addEventListener("click", () => {
          if (window.location.hash === `#${id}`) {
            activeStory = STORY_MAP.get(id);
            startStory();
          } else {
            window.location.hash = id;
          }
        });
        section.append(button);
      }
      return section;
    }),
  );
}

async function renderCoverGallery() {
  if (coverGallery.childElementCount > 0) return;

  const manifest = await fetch("/genre-covers/manifest.json")
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const readyIds = new Set(
    manifest?.books?.filter((book) => book.output?.status === "ready").map((book) => book.id) ??
      genreCoverBooks.map((book) => book.id),
  );
  const priority = new Map([
    ["after-last-train", 0],
    ["seventh-floor-letters", 1],
  ]);
  const visibleBooks = genreCoverBooks
    .filter((book) => readyIds.has(book.id))
    .sort((a, b) => (priority.get(a.id) ?? 99) - (priority.get(b.id) ?? 99));

  const heading = document.createElement("header");
  heading.className = "cover-pack-header";
  heading.innerHTML = `
    <div>
      <span class="cover-pack-kicker">OpenRouter / openai/gpt-image-2 / ${visibleBooks.length} ready</span>
      <h2>Единый фон.<br>Разные иллюстрации.</h2>
    </div>
    <p>У всех обложек одинаковая система фона: полноформатное цветное поле, спокойная верхняя треть и матовая печатная фактура. Жанр меняет только технику и характер главной иллюстрации.</p>
  `;

  const grid = document.createElement("div");
  grid.className = "cover-pack-grid";
  grid.replaceChildren(
    ...visibleBooks.map((book, index) => {
      const article = document.createElement("article");
      article.className = "cover-pack-card";
      article.innerHTML = `
        <figure class="cover-pack-art">
          <img src="/genre-covers/${book.id}.jpg" alt="Обложка ${book.title}" loading="lazy">
          <figcaption>${String(index + 1).padStart(2, "0")}</figcaption>
        </figure>
        <div class="cover-pack-copy">
          <span class="cover-pack-genre">${book.genre}</span>
          <h3>${book.title}</h3>
          <p class="cover-pack-author">${book.author}</p>
          <p class="cover-pack-description">${book.description}</p>
          <details>
            <summary>Промпт стилистики</summary>
            <p>${book.stylePrompt}</p>
          </details>
        </div>
      `;
      return article;
    }),
  );

  coverGallery.append(heading, grid);
}

function createStoryHelpers() {
  return String.raw`
      (function () {
        function findTextRange(needle) {
          var contents = getRendererContents();
          for (var contentIndex = 0; contentIndex < contents.length; contentIndex++) {
            var content = contents[contentIndex];
            if (!content || !content.doc || !content.doc.body) continue;
            var doc = content.doc;
            var nodeFilter = doc.defaultView.NodeFilter;
            var walker = doc.createTreeWalker(doc.body, nodeFilter.SHOW_TEXT);
            var node;
            while ((node = walker.nextNode())) {
              var value = node.nodeValue || '';
              var start = value.indexOf(needle);
              if (start < 0) continue;
              var range = doc.createRange();
              range.setStart(node, start);
              range.setEnd(node, start + needle.length);
              return { content: content, doc: doc, range: range };
            }
          }
          return null;
        }

        function cfiForText(needle) {
          var match = findTextRange(needle);
          if (!match || !view || typeof view.getCFI !== 'function') return null;
          return { match: match, cfi: view.getCFI(match.content.index, match.range) };
        }

        window.__NARRA_STORYBOOK__ = {
          selectText: function (needle) {
            var match = findTextRange(needle);
            if (!match) return false;
            var selection = match.doc.getSelection();
            selection.removeAllRanges();
            selection.addRange(match.range);
            return true;
          },
          annotateText: function (needle, color, note) {
            var result = cfiForText(needle);
            if (!result || !result.cfi) return false;
            var annotation = { value: result.cfi, color: color || '#FFCC00' };
            if (note) annotation.note = note;
            userAnnotations.set(result.cfi, annotation);
            view.addAnnotation(annotation);
            return true;
          },
          highlightTTS: function (needle) {
            var result = cfiForText(needle);
            if (!result || !result.cfi) return false;
            setTTSHighlight(result.cfi, 'rgba(255, 141, 40, 0.32)');
            return true;
          },
          showBookmarkAdded: function () {
            window.setBookmarkPullState(Object.assign({ bookmarked: false }, ${JSON.stringify(bookmarkCopy)}));
            showBookmarkAddedToast();
            if (pullBookmarkResetTimer) {
              clearTimeout(pullBookmarkResetTimer);
              pullBookmarkResetTimer = null;
            }
          },
          showFootnote: function () {
            var tip = document.getElementById('footnote-tip');
            if (!tip) return false;
            var content = tip.querySelector('#footnote-tip-content') || tip;
            content.textContent = 'Полевые записи — короткие наблюдения, сделанные во время исследования.';
            tip.style.left = '24px';
            tip.style.right = '24px';
            tip.style.top = '96px';
            tip.style.maxHeight = '220px';
            tip.dataset.side = 'bottom';
            tip.dataset.state = 'open';
            tip.setAttribute('aria-hidden', 'false');
            return true;
          },
          showLoading: function () {
            var loading = document.getElementById('loading');
            var label = document.getElementById('loading-text');
            if (label) label.textContent = 'Открываем книгу…';
            if (loading) loading.classList.remove('hidden');
          },
          showError: function () {
            var loading = document.getElementById('loading');
            if (!loading) return;
            loading.classList.remove('hidden');
            loading.innerHTML = '<div class="error-text">Не удалось открыть файл книги</div>';
          },
          requestParagraphs: function () {
            handleGetChapterParagraphs();
          },
        };
      })();
  `;
}

function installReaderHarness() {
  const readerWindow = getReaderWindow();
  const readerDocument = readerWindow?.document;
  if (!readerWindow || !readerDocument?.body) return false;

  readerWindow.ReactNativeWebView = {
    postMessage(message) {
      window.postMessage({ source: "narra-webview-storybook", message }, "*");
    },
  };

  const makeProductionBook = readerWindow.makeBook;
  readerWindow.makeBook = async (...args) => {
    const book = await makeProductionBook(...args);
    for (const section of book.sections ?? []) {
      if (section.loadContent || typeof section.createDocument !== "function") continue;
      section.loadContent = async () =>
        new readerWindow.XMLSerializer().serializeToString(section.createDocument());
    }
    return book;
  };

  const helpers = readerDocument.createElement("script");
  helpers.textContent = createStoryHelpers();
  readerDocument.body.append(helpers);
  return true;
}

function getReaderWindow() {
  return frame.contentWindow;
}

function applyBaseReaderDesign(readerWindow) {
  readerWindow.setThemeColors({
    background: "#F5F5F5",
    foreground: "#111111",
    muted: "#8E8E93",
    primary: "#FF8D28",
  });
  readerWindow.applySettings({
    fontSize: 21,
    lineHeight: 1.58,
    paragraphSpacing: 10,
    pageMargin: 24,
    viewMode: "paginated",
    paginatedLayout: "single",
    customFontFaceCSS: `@font-face { font-family: "SB Serif Text"; src: url("${serifRegularUrl}") format("opentype"); font-weight: 400; font-style: normal; }\n@font-face { font-family: "SB Serif Text"; src: url("${serifBoldUrl}") format("opentype"); font-weight: 700; font-style: normal; }`,
    customFontFamily: "SB Serif Text",
  });
}

function applyStory(readerWindow) {
  if (storyApplied || !readerWindow.__NARRA_STORYBOOK__) return;
  storyApplied = true;
  const helpers = readerWindow.__NARRA_STORYBOOK__;

  switch (activeStory.id) {
    case "scroll":
      readerWindow.applySettings({ viewMode: "scroll" });
      break;
    case "large-text":
      readerWindow.applySettings({
        fontSize: 29,
        lineHeight: 1.68,
        paragraphSpacing: 14,
        pageMargin: 26,
      });
      break;
    case "dark":
      readerWindow.setThemeColors({
        background: "#111111",
        foreground: "#F5F5F5",
        muted: "#8E8E93",
        primary: "#FF9230",
      });
      break;
    case "bookmark-added":
      helpers.showBookmarkAdded();
      break;
    case "selection":
      helpers.selectText("тишина словно отступила");
      break;
    case "search":
      readerWindow.search("письмо");
      break;
    case "highlight":
      helpers.annotateText("Письмо лежало на столе", "#FFCC00");
      break;
    case "note":
      helpers.annotateText(
        "тишина словно отступила",
        "#46DC66",
        "Поворотный момент: героиня решает продолжить путь.",
      );
      break;
    case "tts":
      helpers.highlightTTS("Письмо лежало на столе");
      break;
    case "translation":
      helpers.requestParagraphs();
      break;
    case "footnote":
      helpers.showFootnote();
      // The production reader closes transient tips on the first relocation.
      readerWindow.setTimeout(() => helpers.showFootnote(), 420);
      break;
    default:
      break;
  }
}

function openSampleBook(readerWindow) {
  return readerWindow.handleCommand({
    type: "openBook",
    base64: encodeBase64(sampleBook),
    fileName: "narra-webview-story.fb2",
    mimeType: "application/x-fictionbook+xml",
    pageMargin: 24,
    paginatedLayout: "single",
    settings: {
      fontSize: 21,
      lineHeight: 1.58,
      paragraphSpacing: 10,
      pageMargin: 24,
      viewMode: "paginated",
      paginatedLayout: "single",
      customFontFaceCSS: `@font-face { font-family: "SB Serif Text"; src: url("${serifRegularUrl}") format("opentype"); font-weight: 400; font-style: normal; }\n@font-face { font-family: "SB Serif Text"; src: url("${serifBoldUrl}") format("opentype"); font-weight: 700; font-style: normal; }`,
      customFontFamily: "SB Serif Text",
    },
  });
}

async function bootReader(run) {
  const startedAt = Date.now();
  let readerWindow = getReaderWindow();
  while (
    run === currentRun &&
    (typeof readerWindow?.handleCommand !== "function" ||
      typeof readerWindow?.makeBook !== "function" ||
      !readerWindow?.__NARRA_STORYBOOK__) &&
    Date.now() - startedAt < 6000
  ) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    readerWindow = getReaderWindow();
  }

  if (
    run !== currentRun ||
    typeof readerWindow?.handleCommand !== "function" ||
    !readerWindow?.__NARRA_STORYBOOK__
  ) {
    if (run === currentRun) status.textContent = "Reader не готов";
    return;
  }

  readerWindow.setThemeColors({
    background: "#F5F5F5",
    foreground: "#111111",
    muted: "#8E8E93",
    primary: "#FF8D28",
  });

  if (activeStory.id === "loading") {
    readerWindow.__NARRA_STORYBOOK__.showLoading();
    status.textContent = "Загрузка";
    return;
  }
  if (activeStory.id === "error") {
    readerWindow.__NARRA_STORYBOOK__.showError();
    status.textContent = "Ошибка";
    return;
  }

  try {
    await openSampleBook(readerWindow);
    if (run !== currentRun) return;
    applyBaseReaderDesign(readerWindow);
    applyStory(readerWindow);
    status.textContent = "Готово";
  } catch (error) {
    if (run !== currentRun) return;
    status.textContent = "Ошибка";
    console.error("[WebView Storybook] Failed to open sample book", error);
  }
}

function startStory() {
  currentRun += 1;
  storyApplied = false;
  title.textContent = activeStory.title;
  description.textContent = activeStory.description;
  status.textContent = "Загрузка";
  renderNavigation();

  const isCoverGallery = activeStory.id === "genre-covers";
  frame.hidden = isCoverGallery;
  viewportLabel.hidden = isCoverGallery;
  coverGallery.hidden = !isCoverGallery;
  readerActions.hidden = isCoverGallery;
  previewStage.classList.toggle("cover-pack-mode", isCoverGallery);
  if (isCoverGallery) {
    void renderCoverGallery();
    return;
  }

  const separator = readerUrl.includes("?") ? "&" : "?";
  frame.src = `${readerUrl}${separator}story=${currentRun}`;
}

window.addEventListener("message", (event) => {
  if (event.data?.source !== "narra-webview-storybook") return;

  let message;
  try {
    message = JSON.parse(event.data.message);
  } catch {
    return;
  }

  const readerWindow = getReaderWindow();
  if (!readerWindow) return;

  if (message.type === "ready") {
    status.textContent = "Reader готов";
  }

  if (message.type === "loaded") {
    status.textContent = "Книга открыта";
  }

  if (message.type === "relocate" && (!storyApplied || activeStory.id === "footnote")) {
    const run = currentRun;
    window.setTimeout(() => {
      if (run !== currentRun) return;
      applyBaseReaderDesign(readerWindow);
      applyStory(readerWindow);
      // reader.html hides transient tooltips on every relocation. Re-open the
      // static footnote story after the production reader has settled.
      if (activeStory.id === "footnote") {
        readerWindow.__NARRA_STORYBOOK__?.showFootnote();
      }
    }, 180);
  }

  if (message.type === "relocate") {
    const page = message.page ?? message.location ?? message.section;
    if (page?.total) status.textContent = `${Number(page.current) + 1} / ${page.total}`;
  }

  if (message.type === "searchComplete") {
    status.textContent = `Найдено: ${message.count ?? 0}`;
  }

  if (message.type === "chapterParagraphs" && activeStory.id === "translation") {
    const translations = (message.paragraphs ?? []).slice(0, 4).map((paragraph, index) => ({
      paragraphId: paragraph.id,
      originalText: paragraph.text,
      translatedText: [
        "The room grew quieter as Lina approached the window.",
        "A letter lay on the table, sealed with dark wax.",
        "Outside, the city slowly woke after the rain.",
        "She understood that the journey had already begun.",
      ][index],
    }));
    readerWindow.doInjectChapterTranslations(translations, {
      originalVisible: true,
      translationVisible: true,
    });
  }
});

previousPage.addEventListener("click", () => getReaderWindow()?.goPrev());
nextPage.addEventListener("click", () => getReaderWindow()?.goNext());
frame.addEventListener("load", () => {
  if (!installReaderHarness()) {
    status.textContent = "Reader не готов";
    return;
  }
  void bootReader(currentRun);
});

window.addEventListener("hashchange", () => {
  activeStory = getStoryFromHash();
  startStory();
});

renderNavigation();
startStory();

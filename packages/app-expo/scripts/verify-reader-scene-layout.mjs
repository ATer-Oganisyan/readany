/**
 * Real Foliate/EPUB layout regression, including WebKit (not a DOM mock).
 * Build first: pnpm run build:reader
 * Run with Playwright installed: node scripts/verify-reader-scene-layout.mjs
 * NODE_PATH may point to the Codex bundled Node packages; no backend is called.
 */
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { webkit, chromium } = require("playwright");
const { configure, ZipWriter, Uint8ArrayWriter, TextReader } = require("@zip.js/zip.js");
configure({ useWebWorkers: false });

const prose = "Анна открыла книгу. За окном тихо шумел сад, и тёплый свет падал на страницы. ";
const paragraphs = Array.from({ length: 16 }, (_, index) =>
  `<p data-test="p${index}">${index + 1}. ${prose.repeat(index === 2 ? 48 : 8)}</p>`
).join("");
const zip = new ZipWriter(new Uint8ArrayWriter());
const entries = {
  mimetype: "application/epub+zip",
  "META-INF/container.xml": `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  "book.opf": `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">scene-layout-regression</dc:identifier><dc:title>Scene layout</dc:title><dc:language>ru</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
  "chapter.xhtml": `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Scene layout</title><style>body { margin: 0; } p { text-align: justify; } .epigraph { float: right; width: 45%; } .epigraph p { margin: 0; }</style></head><body><section><h1>Проверка сцены</h1>${paragraphs}<div class="epigraph"><p data-test="epigraph">${prose.repeat(4)}</p></div><p data-test="after-epigraph">${prose.repeat(8)}</p></section></body></html>`,
};
for (const [name, content] of Object.entries(entries)) {
  await zip.add(name, new TextReader(content), { level: name === "mimetype" ? 0 : 6 });
}
const base64 = Buffer.from(await zip.close()).toString("base64");
const html = await readFile(new URL("../assets/reader/reader.html", import.meta.url));
const foliateSources = new Map(await Promise.all([
  "epubcfi.js", "tests/tests.js", "tests/epubcfi-tests.js",
].map(async name => [`/foliate/${name}`, await readFile(new URL(`../../foliate-js/${name}`, import.meta.url))])));
const server = createServer((req, res) => {
  const script = foliateSources.get(req.url);
  res.writeHead(200, { "Content-Type": script ? "text/javascript" : "text/html; charset=utf-8" });
  res.end(script ?? html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const artifacts = await mkdtemp(join(tmpdir(), "narra-scene-layout-"));

async function settle(page) {
  await page.evaluate(async () => {
    for (const { doc } of getRendererContents()) await doc.fonts.ready;
    for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
  });
}

async function checkPixelOpacity(page, anchor, minPeak = 6) {
  const result = await page.evaluate(anchor => {
    const canvas = findSceneInsert(anchor).querySelector('canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let max = 0;
    let clear = 0;
    let weak = 0;
    for (let i = 3; i < data.length; i += 4) {
      max = Math.max(max, data[i]);
      if (data[i] === 0) clear++;
      if (data[i] > 0 && data[i] <= 5) weak++;
    }
    return { max, clear, weak };
  }, anchor);
  assert.ok(result.max >= minPeak && result.max <= 20, `Actual canvas alpha stays visible and bounded by Primary 8: ${JSON.stringify(result)}`);
  assert.ok(result.clear > 0 && result.weak > 0, 'Pixels retain subtle Primary 1 areas and transparent edges');
}

async function measure(page, anchor) {
  return page.evaluate(anchor => {
    const slot = findSceneInsert(anchor);
    const doc = slot.ownerDocument;
    const win = doc.defaultView;
    const bounds = node => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const action = slot.querySelector('.readany-scene-action');
    const next = slot.nextElementSibling;
    const firstNextRect = next?.getClientRects()[0];
    const rootStyle = win.getComputedStyle(doc.documentElement);
    return {
      slot: bounds(slot),
      background: win.getComputedStyle(slot).backgroundColor,
      tapHighlights: [...new Set([slot, ...slot.querySelectorAll('*')].map(el => win.getComputedStyle(el).webkitTapHighlightColor))],
      box: slot.firstElementChild ? bounds(slot.firstElementChild) : null,
      fragments: slot.getClientRects().length,
      stroke: slot.querySelector('.readany-scene-flow-border rect') && {
        color: win.getComputedStyle(slot.querySelector('.readany-scene-flow-border rect')).stroke,
        dash: win.getComputedStyle(slot.querySelector('.readany-scene-flow-border rect')).strokeDasharray,
        animation: win.getComputedStyle(slot.querySelector('.readany-scene-flow-border rect')).animationName,
      },
      pageTop: parseFloat(rootStyle.paddingTop),
      columnWidth: parseFloat(rootStyle.columnWidth),
      pageHeight: parseFloat(rootStyle.getPropertyValue('--available-height')),
      next: firstNextRect && { x: firstNextRect.x, y: firstNextRect.y, width: firstNextRect.width },
      action: action && {
        ...bounds(action), tag: action.localName, type: action.type,
        color: win.getComputedStyle(action).color, font: win.getComputedStyle(action).fontFamily,
        border: win.getComputedStyle(action).borderTopWidth,
        borderColor: win.getComputedStyle(action).borderTopColor,
        background: win.getComputedStyle(action).backgroundColor,
        backdropFilter: win.getComputedStyle(action, '::before').backdropFilter || win.getComputedStyle(action, '::before').webkitBackdropFilter,
        transitionDuration: win.getComputedStyle(action).transitionDuration,
        transitionTiming: win.getComputedStyle(action).transitionTimingFunction,
        radius: win.getComputedStyle(action).borderRadius,
        iconWidth: action.querySelector('svg').getBoundingClientRect().width,
      },
    };
  }, anchor);
}

function checkSquare(layout, label) {
  assert.ok(layout.slot.width > 100, `${label}: useful square width ${JSON.stringify(layout)}`);
  assert.ok(Math.abs(layout.slot.width - layout.slot.height) < 1, `${label}: square ${JSON.stringify(layout)}`);
  assert.ok(Math.abs(layout.slot.y - layout.pageTop) < 1, `${label}: page top ${JSON.stringify(layout)}`);
  assert.ok(layout.slot.width <= layout.columnWidth + 1, `${label}: within text column`);
  assert.ok(layout.slot.height <= layout.pageHeight + 1, `${label}: within page height`);
  assert.equal(layout.fragments, 1, `${label}: not fragmented`);
}

let failed = false;
try {
  for (const engine of [webkit, chromium]) {
    const browser = await engine.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 393, height: 740 } });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    try {
      await page.addInitScript(() => {
        window.__readerMessages = [];
        window.ReactNativeWebView = { postMessage: value => window.__readerMessages.push(JSON.parse(value)) };
      });
      await page.goto(url);
      await page.evaluate(async base64 => {
        setThemeColors({ background: '#282828', foreground: '#ffffffcc', muted: '#ffffff80', primary5: '#ffffff0d', primary8: '#ffffff14', primary10: '#ffffff1a', primary20: '#ffffff33', primary40: '#ffffff66', elevation1: '#1d1d1d', elevation2: '#282828' });
        await openBook({ base64, fileName: 'scene-layout.epub', settings: { fontSize: 20, lineHeight: 1.5, paragraphSpacing: 12, pageMargin: 16, viewMode: 'paginated', paginatedLayout: 'single' } });
      }, base64);
      await settle(page);

      const bookmarkBefore = await page.evaluate(() => {
        const doc = getRendererContents()[0].doc;
        const range = doc.createRange();
        const text = doc.querySelector('[data-test="p12"]').firstChild;
        range.setStart(text, 8);
        range.setEnd(text, 25);
        return { cfi: view.getCFI(0, range), text: range.toString() };
      });

      const anchor = await page.evaluate(async () => {
        const doc = getRendererContents()[0].doc;
        await view.renderer.goTo({ index: 0, anchor: () => doc.querySelector('[data-test="p2"]') });
        window.insertSceneSlot();
        const slot = doc.querySelector('.readany-scene-insert');
        if (!slot) throw new Error('Scene was not inserted by insertSceneSlot');
        return slot.getAttribute('data-readany-scene-anchor');
      });
      await settle(page);
      const initial = await measure(page, anchor);
      checkSquare(initial, `${engine.name()} idle`);
      assert.ok(initial.next.width > initial.columnWidth * 0.8, 'Text below keeps full column width');
      assert.ok(initial.next.y >= initial.slot.y + initial.slot.height, 'Text starts below the square');
      assert.equal(initial.action.color, 'rgba(255, 255, 255, 0.4)');
      assert.ok(initial.action.font.includes('SB Sans Interface'));
      assert.equal(initial.action.tag, 'button');
      assert.equal(initial.action.type, 'button');
      assert.equal(initial.action.border, '1px');
      assert.equal(initial.action.radius, '9999px');
      assert.equal(initial.stroke.dash, 'none');
      assert.equal(initial.stroke.animation, 'none');
      assert.equal(initial.stroke.color, 'rgba(255, 255, 255, 0.05)');
      assert.equal(initial.action.borderColor, 'rgba(255, 255, 255, 0.1)');
      assert.equal(initial.background, 'rgb(29, 29, 29)');
      assert.equal(initial.action.background, 'rgb(40, 40, 40)');
      assert.equal(initial.action.transitionDuration, '0.15s');
      assert.equal(initial.action.transitionTiming, 'cubic-bezier(0.33, 1, 0.68, 1)');
      assert.equal(initial.action.iconWidth, 16);
      assert.equal(initial.action.height, 36);
      await page.evaluate(anchor => {
        view.renderer.scrollToAnchor(findSceneInsert(anchor));
        document.body.style.backgroundColor = '#282828';
      }, anchor);
      await settle(page);
      const idleCanvas = await page.evaluate(anchor => {
        const slot = findSceneInsert(anchor);
        const canvas = slot.querySelector('canvas');
        const button = slot.querySelector('button');
        const rect = button.getBoundingClientRect();
        const win = slot.ownerDocument.defaultView;
        return {
          preset: canvas.getAttribute('data-scene-effect'), data: canvas.toDataURL(),
          buttonOnTop: Number(win.getComputedStyle(button).zIndex) > Number(win.getComputedStyle(canvas).zIndex),
          hit: slot.ownerDocument.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button') === button,
        };
      }, anchor);
      assert.equal(idleCanvas.preset, 'pixels-organic', 'Idle uses organic pixels behind the button');
      assert.ok(idleCanvas.buttonOnTop && idleCanvas.hit, 'Animated background does not cover or intercept the button');
      await checkPixelOpacity(page, anchor);
      await page.waitForTimeout(350);
      assert.ok(await page.evaluate(anchor => findSceneInsert(anchor).querySelector('canvas').toDataURL(), anchor) !== idleCanvas.data, 'Idle background moves before generation starts');
      assert.equal(await page.evaluate(() => window.__readerMessages.filter(item => item.type === 'sceneSlotTap').length), 0, 'Idle animation does not request generation');
      // Exercise the first canvas in a fresh chapter BEFORE any state change
      // remounts it. A remount can hide a missing theme subscription.
      for (const theme of ['light', 'sepia', 'dark', 'light', 'dark']) {
        await page.evaluate(theme => {
          const dark = theme === 'dark';
          const background = dark ? '#282828' : theme === 'sepia' ? '#efe1c6' : '#dedede';
          setThemeColors({ background, foreground: dark ? '#ffffffcc' : '#111111cc', muted: dark ? '#ffffff80' : '#11111180', primary5: dark ? '#ffffff0d' : '#1111110d', primary8: dark ? '#ffffff14' : '#11111114', primary10: dark ? '#ffffff1a' : '#1111111a', primary40: dark ? '#ffffff66' : '#11111166', elevation1: dark ? '#1d1d1d' : '#1111110a', sceneActionColor: theme === 'sepia' ? '#3b3125' : dark ? '#ffffff66' : '#11111166', elevation2: dark ? '#282828' : `color-mix(in srgb, ${theme === 'sepia' ? background : `color-mix(in srgb, ${background} 70%, #ffffff 30%)`} 70%, transparent)` });
          document.body.style.backgroundColor = background;
        }, theme);
        await settle(page);
        const pixels = await page.evaluate(anchor => {
          const canvas = findSceneInsert(anchor).querySelector('canvas');
          const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let peak = 3;
          for (let i = 7; i < data.length; i += 4) if (data[i] > data[peak]) peak = i;
          return { red: data[peak - 3], alpha: data[peak], frame: canvas.toDataURL() };
        }, anchor);
        assert.ok(theme === 'dark' ? pixels.red > 240 : pixels.red < 40, `${theme}: first canvas switches its actual ink, got ${pixels.red}`);
        if (theme !== 'dark') assert.ok(pixels.alpha >= 17, `${theme}: first canvas uses the visible light range`);
        await page.waitForTimeout(400);
        assert.notEqual(await page.evaluate(anchor => findSceneInsert(anchor).querySelector('canvas').toDataURL(), anchor), pixels.frame, `${theme}: continues moving without navigating or remounting`);
        checkSquare(await measure(page, anchor), `${theme}: first canvas after theme change`);
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await settle(page);
      const idleStill = await page.evaluate(anchor => findSceneInsert(anchor).querySelector('canvas').toDataURL(), anchor);
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(anchor => findSceneInsert(anchor).querySelector('canvas').toDataURL(), anchor), idleStill, 'Reduced motion also stops idle pixels');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      assert.ok(initial.action.width < initial.slot.width - 24, 'Button hugs its label inside the square');
      assert.ok(Math.abs(initial.action.y + initial.action.height / 2 - initial.slot.y - initial.slot.height / 2) < 1, 'Action is vertically centered');
      const selectionGuard = await page.evaluate(anchor => {
        const slot = findSceneInsert(anchor);
        const doc = slot.ownerDocument;
        const win = doc.defaultView;
        const button = slot.querySelector('button');
        const bookText = doc.querySelector('[data-test="p3"]');
        return {
          sceneSelectable: [slot, ...slot.querySelectorAll('*')].some(el => win.getComputedStyle(el).webkitUserSelect !== 'none'),
          buttonSelectStart: button.dispatchEvent(new win.Event('selectstart', { bubbles: true, cancelable: true })),
          bookSelectStart: bookText.dispatchEvent(new win.Event('selectstart', { bubbles: true, cancelable: true })),
          bookSelectable: win.getComputedStyle(bookText).webkitUserSelect,
        };
      }, anchor);
      assert.equal(selectionGuard.sceneSelectable, false, 'All scene descendants forbid selection');
      assert.equal(selectionGuard.buttonSelectStart, false, 'Scene selectstart is cancelled');
      assert.equal(selectionGuard.bookSelectStart, true, 'Book selectstart is untouched');
      assert.equal(selectionGuard.bookSelectable, 'text');
      for (const state of ['idle', 'loading', 'error']) {
        await page.evaluate(({ anchor, state }) => {
          setSceneSlotState(anchor, state);
          const slot = findSceneInsert(anchor);
          const doc = slot.ownerDocument;
          const range = doc.createRange();
          range.selectNode(slot.querySelector('button') || slot.querySelector('.readany-scene-pixels'));
          doc.getSelection().removeAllRanges();
          doc.getSelection().addRange(range);
        }, { anchor, state });
        await page.waitForFunction(() => getRendererContents()[0].doc.getSelection().isCollapsed);
        assert.equal(await page.evaluate(() => window.__readerMessages.filter(item => item.type === 'selection').length), 0, 'Scene never opens native selection actions');
      }
      const selectedBookText = await page.evaluate(() => {
        const doc = getRendererContents()[0].doc;
        const range = doc.createRange();
        range.setStart(doc.querySelector('[data-test="p3"]').firstChild, 3);
        range.setEnd(doc.querySelector('[data-test="p3"]').firstChild, 20);
        doc.getSelection().addRange(range);
        return range.toString();
      });
      await page.waitForFunction(text => window.__readerMessages.some(item => item.type === 'selection' && item.text === text), selectedBookText);
      await page.evaluate(anchor => {
        clearDocumentSelection(getRendererContents()[0].doc);
        setSceneSlotState(anchor, 'idle');
      }, anchor);
      await settle(page);
      const bookmarkAfter = await page.evaluate(() => {
        const doc = getRendererContents()[0].doc;
        const range = doc.createRange();
        const text = doc.querySelector('[data-test="p12"]').firstChild;
        range.setStart(text, 8);
        range.setEnd(text, 25);
        return view.getCFI(0, range);
      });
      assert.equal(bookmarkAfter, bookmarkBefore.cfi, 'Scene does not renumber book CFIs');
      const markedBookmark = await page.evaluate(bookmark => {
        const doc = getRendererContents()[0].doc;
        const text = doc.querySelector('[data-test="p12"]').firstChild.splitText(8);
        text.splitText(17);
        const span = doc.createElement('span');
        span.className = 'readany-character-name';
        text.replaceWith(span);
        span.appendChild(text);
        const range = doc.createRange();
        range.selectNodeContents(text);
        return { cfi: view.getCFI(0, range), resolved: view.resolveCFI(bookmark.cfi).anchor(doc).toString() };
      }, bookmarkBefore);
      assert.equal(markedBookmark.cfi, bookmarkBefore.cfi, 'Marked character text keeps its original offset');
      assert.equal(markedBookmark.resolved, bookmarkBefore.text, 'CFI resolution uses the same filter');

      await page.evaluate(anchor => {
        view.renderer.scrollToAnchor(findSceneInsert(anchor));
        document.body.style.backgroundColor = '#282828';
      }, anchor);
      await settle(page);
      await page.screenshot({ path: join(artifacts, `${engine.name()}-button.png`) });
      await page.evaluate(() => setThemeColors({ background: '#dedede', foreground: '#111111cc', muted: '#11111180', primary5: '#1111110d', primary8: '#11111114', primary10: '#1111111a', primary40: '#11111166', elevation1: '#1111110a', elevation2: 'color-mix(in srgb, color-mix(in srgb, #dedede 70%, #ffffff 30%) 70%, transparent)' }));
      await settle(page);
      const light = await measure(page, anchor);
      assert.equal(light.background, 'rgba(17, 17, 17, 0.04)');
      assert.ok(light.action.background.startsWith('color(srgb 0.909'), `Light uses slightly lifted paper at 70%: ${light.action.background}`);
      assert.equal(light.action.backdropFilter, 'blur(10px)');
      assert.equal(light.action.borderColor, 'rgba(17, 17, 17, 0.1)');
      assert.equal(light.stroke.color, 'rgba(17, 17, 17, 0.05)');
      assert.deepEqual(light.slot, initial.slot, 'Theme changes do not move the square');
      // Idle must be visible too, not just the stronger loading preset.
      for (const theme of ['light', 'sepia']) {
        await page.evaluate(theme => {
          const background = theme === 'sepia' ? '#efe1c6' : '#dedede';
          setThemeColors({ background, foreground: '#111111cc', muted: '#11111180', primary5: '#1111110d', primary8: '#11111114', primary10: '#1111111a', primary40: '#11111166', sceneActionColor: theme === 'sepia' ? '#3b3125' : '#11111166', elevation1: '#1111110a', elevation2: `color-mix(in srgb, ${theme === 'sepia' ? background : `color-mix(in srgb, ${background} 70%, #ffffff 30%)`} 70%, transparent)` });
          document.body.style.backgroundColor = background;
        }, theme);
        await settle(page);
        await checkPixelOpacity(page, anchor, 17);
        const first = await page.evaluate(anchor => findSceneInsert(anchor).querySelector('canvas').toDataURL(), anchor);
        await page.screenshot({ path: join(artifacts, `${engine.name()}-idle-${theme}.png`) });
        await page.waitForTimeout(600);
        const second = await page.evaluate(anchor => findSceneInsert(anchor).querySelector('canvas').toDataURL(), anchor);
        assert.notEqual(first, second, `${theme}: idle animation is moving`);
        await checkPixelOpacity(page, anchor, 17);
        await page.screenshot({ path: join(artifacts, `${engine.name()}-idle-${theme}-next.png`) });
        const themedSlot = await measure(page, anchor);
        checkSquare(themedSlot, `${theme} idle`);
        assert.equal(themedSlot.action.color, theme === 'sepia' ? 'rgb(59, 49, 37)' : 'rgba(17, 17, 17, 0.4)');
        assert.equal(themedSlot.action.backdropFilter, 'blur(10px)');
        if (theme === 'sepia') assert.ok(themedSlot.action.background.startsWith('color(srgb 0.937'), `Sepia paper fill at 70%: ${themedSlot.action.background}`);
      }
      await page.evaluate(() => {
        setThemeColors({ background: '#282828', foreground: '#ffffffcc', muted: '#ffffff80', primary5: '#ffffff0d', primary8: '#ffffff14', primary10: '#ffffff1a', primary40: '#ffffff66', elevation1: '#1d1d1d', elevation2: '#282828' });
        document.body.style.backgroundColor = '#282828';
      });
      await settle(page);
      const requestsBefore = await page.evaluate(() => window.__readerMessages.filter(item => item.type === 'sceneSlotTap').length);
      await page.evaluate(anchor => findSceneInsert(anchor).querySelector('button').focus(), anchor);
      await page.keyboard.press('Enter');
      await settle(page);
      assert.equal(await page.evaluate(anchor => findSceneInsert(anchor).getAttribute('data-readany-scene-state'), anchor), 'loading', 'Keyboard activation starts the scene');
      assert.equal(await page.evaluate(() => window.__readerMessages.filter(item => item.type === 'sceneSlotTap').length), requestsBefore + 1, 'Keyboard activates exactly once');
      await page.evaluate(anchor => setSceneSlotState(anchor, 'idle'), anchor);
      await settle(page);
      await page.evaluate(() => {
        window.__scenePointerTrace = [];
        const doc = getRendererContents()[0].doc;
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click']) {
          doc.addEventListener(type, event => window.__scenePointerTrace.push({
            type, time: event.timeStamp, target: event.target.localName,
            x: event.clientX, y: event.clientY, selection: doc.getSelection().toString(),
          }), true);
        }
      });
      const point = await page.evaluate(anchor => {
        const button = findSceneInsert(anchor).querySelector('button');
        const rect = button.getBoundingClientRect();
        const frame = button.ownerDocument.defaultView.frameElement.getBoundingClientRect();
        return { x: frame.x + rect.x + rect.width / 2, y: frame.y + rect.y + rect.height / 2 };
      }, anchor);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.waitForFunction(anchor => {
        const action = findSceneInsert(anchor).querySelector('button');
        const style = action.ownerDocument.defaultView.getComputedStyle(action);
        return Math.abs(new DOMMatrix(style.transform).a - 0.97) < 0.0001;
      }, anchor);
      await settle(page);
      const pressed = await measure(page, anchor);
      assert.deepEqual(pressed.tapHighlights, ['rgba(0, 0, 0, 0)'], 'No native tap overlay inside the scene');
      assert.equal(initial.stroke.color, 'rgba(255, 255, 255, 0.05)');
      assert.equal(pressed.stroke.color, initial.stroke.color, 'Press keeps the outer Primary5 stroke');
      assert.equal(pressed.background, initial.background, 'Press keeps the outer Elevation1 surface');
      assert.equal(pressed.action.borderColor, initial.action.borderColor, 'Press keeps the button Primary10 stroke');
      assert.equal(pressed.action.background, initial.action.background, 'Cover press scales without recoloring');
      assert.deepEqual(pressed.slot, initial.slot, 'Press never changes page layout');
      await page.screenshot({ path: join(artifacts, `${engine.name()}-button-pressed.png`) });
      // A cancelled drag releases the press and must not generate a scene.
      await page.mouse.move(point.x, point.y + 60);
      await page.mouse.up();
      await page.waitForFunction(anchor => {
        const action = findSceneInsert(anchor).querySelector('button');
        return Math.abs(new DOMMatrix(action.ownerDocument.defaultView.getComputedStyle(action).transform).a - 1) < 0.0001;
      }, anchor);
      assert.equal(await page.evaluate(() => window.__readerMessages.filter(item => item.type === 'sceneSlotTap').length), requestsBefore + 1, 'Cancel does not activate');
      await page.mouse.click(point.x, point.y);
      await settle(page);
      assert.equal(await page.evaluate(anchor => findSceneInsert(anchor).getAttribute('data-readany-scene-state'), anchor), 'loading', `Pointer activation starts the scene: ${JSON.stringify(await page.evaluate(() => window.__scenePointerTrace))}`);
      await page.mouse.click(point.x, point.y);
      assert.equal(await page.evaluate(() => window.__readerMessages.filter(item => item.type === 'sceneSlotTap').length), requestsBefore + 2, 'Loading ignores repeated activation');

      for (const state of ['loading', 'error', 'idle']) {
        await page.evaluate(({ anchor, state }) => setSceneSlotState(anchor, state), { anchor, state });
        await settle(page);
        const layout = await measure(page, anchor);
        assert.deepEqual(layout.tapHighlights, ['rgba(0, 0, 0, 0)'], `${state}: all scene descendants suppress native tap highlighting`);
        checkSquare(layout, `${engine.name()} ${state}`);
        assert.deepEqual(layout.slot, initial.slot, `${state}: same reserved geometry`);
        assert.equal(layout.stroke.color, initial.stroke.color, `${state}: retains Primary5 frame`);
        assert.equal(layout.background, initial.background, `${state}: retains Elevation1 surface`);
        if (state === 'loading') {
          const pixels = () => page.evaluate(anchor => {
            const slot = findSceneInsert(anchor);
            const canvas = slot.querySelector('canvas');
            const rect = canvas.getBoundingClientRect();
            return {
              text: slot.textContent.trim(), label: slot.querySelector('[role="status"]').getAttribute('aria-label'),
              width: rect.width, height: rect.height,
              data: canvas.toDataURL(),
              preset: canvas.getAttribute('data-scene-effect'),
              drawn: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(v => v !== 0),
            };
          }, anchor);
          const first = await pixels();
          assert.equal(first.preset, 'sweep-gradient', 'Loading switches to Gradient Sweep');
          assert.equal(first.text, '', 'Loading has no visible text or logo');
          assert.ok(first.label.length > 0, 'Loading remains labelled for VoiceOver');
          assert.equal(first.width, layout.slot.width, 'Animation fills reserved square');
          assert.equal(first.height, layout.slot.height);
          assert.ok(first.drawn, 'Canvas is not blank');
          await checkPixelOpacity(page, anchor);
          await page.screenshot({ path: join(artifacts, `${engine.name()}-loading.png`) });
          await page.waitForTimeout(350);
          assert.notEqual((await pixels()).data, first.data, 'Gradient wave moves while loading');
          await page.evaluate(() => view.renderer.goTo({ index: 0, anchor: () => getRendererContents()[0].doc.querySelector('h1') }));
          await page.waitForTimeout(350);
          const offscreen = await pixels();
          await page.waitForTimeout(350);
          assert.equal((await pixels()).data, offscreen.data, 'Offscreen scene stops animating');
          await page.evaluate(anchor => view.renderer.goTo({ index: 0, anchor: () => findSceneInsert(anchor) }), anchor);
          await settle(page);
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await settle(page);
          const still = await pixels();
          await page.waitForTimeout(350);
          assert.equal((await pixels()).data, still.data, 'Reduced motion holds a static mosaic');
          await page.evaluate(() => setThemeColors({ background: '#dedede', foreground: '#111111cc', muted: '#11111180', primary5: '#1111110d', primary8: '#11111114', primary10: '#1111111a', primary40: '#11111166', elevation1: '#1111110a', elevation2: 'color-mix(in srgb, color-mix(in srgb, #dedede 70%, #ffffff 30%) 70%, transparent)' }));
          await settle(page);
          assert.notEqual((await pixels()).data, still.data, 'Loading adapts to light theme without remount');
          await checkPixelOpacity(page, anchor);
          assert.equal((await measure(page, anchor)).stroke.color, 'rgba(17, 17, 17, 0.05)');
          await page.screenshot({ path: join(artifacts, `${engine.name()}-loading-light.png`) });
          await page.evaluate(() => {
            setThemeColors({ background: '#efe1c6', foreground: '#3b3125', muted: '#8a7a63', primary5: '#1111110d', primary8: '#11111114', primary10: '#1111111a', primary40: '#11111166', elevation1: '#1111110a', elevation2: 'color-mix(in srgb, color-mix(in srgb, #dedede 70%, #ffffff 30%) 70%, transparent)' });
            document.body.style.backgroundColor = '#efe1c6';
          });
          await settle(page);
          assert.equal((await measure(page, anchor)).background, 'rgba(17, 17, 17, 0.04)', 'Sepia uses Primary 4 instead of a dark elevation surface');
          await checkPixelOpacity(page, anchor);
          await page.screenshot({ path: join(artifacts, `${engine.name()}-loading-sepia.png`) });
          await page.evaluate(() => {
            setThemeColors({ background: '#282828', foreground: '#ffffffcc', muted: '#ffffff80', primary5: '#ffffff0d', primary8: '#ffffff14', primary10: '#ffffff1a', primary40: '#ffffff66', elevation1: '#1d1d1d', elevation2: '#282828' });
            document.body.style.backgroundColor = '#282828';
          });
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          await settle(page);
          await page.evaluate(anchor => { window.__retiredSceneCanvas = findSceneInsert(anchor).querySelector('canvas'); }, anchor);
        }
      }
      const retired = await page.evaluate(() => window.__retiredSceneCanvas.toDataURL());
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => window.__retiredSceneCanvas.toDataURL()), retired, 'Leaving loading disposes its animation');

      const imageDataUri = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#625154';
        ctx.fillRect(0, 0, 1024, 1024);
        return canvas.toDataURL();
      });
      await page.evaluate(({ anchor, imageDataUri }) => replaceSceneSlot(anchor, imageDataUri), { anchor, imageDataUri });
      await settle(page);
      assert.deepEqual((await measure(page, anchor)).slot, initial.slot, 'Image arrival does not move text');

      await page.evaluate(() => applySettings({ fontSize: 28, lineHeight: 1.7, pageMargin: 16 }));
      await settle(page);
      checkSquare(await measure(page, anchor), `${engine.name()} large font`);
      for (const viewport of [{ width: 844, height: 390 }, { width: 393, height: 740 }]) {
        await page.setViewportSize(viewport);
        await settle(page);
        checkSquare(await measure(page, anchor), `${engine.name()} ${viewport.width}x${viewport.height}`);
        await page.evaluate(anchor => view.renderer.scrollToAnchor(findSceneInsert(anchor)), anchor);
        await settle(page);
        const pageAnchor = await page.evaluate(() => {
          const doc = getRendererContents()[0].doc;
          const range = view.resolveCFI(view.lastLocation.cfi).anchor(doc);
          return range.startContainer === doc.body;
        });
        assert.equal(pageAnchor, false, 'A scene page must not reset the bookmark to the book start');
      }

      const savedScenes = await page.evaluate(async () => {
        const doc = getRendererContents()[0].doc;
        await view.renderer.goTo({ index: 0, anchor: () => doc.querySelector('[data-test="p8"]') });
        window.insertSceneSlot();
        return Array.from(doc.querySelectorAll('.readany-scene-insert'), el => ({
          anchor: el.getAttribute('data-readany-scene-anchor'),
          previous: el.previousElementSibling?.getAttribute('data-test'),
        }));
      });
      assert.equal(savedScenes.length, 2, 'A second independent scene is inserted');
      await page.evaluate(scenes => {
        removeSceneSlot(scenes[1].anchor);
        setSceneAnchors(scenes.map(item => item.anchor));
      }, savedScenes);
      await settle(page);
      const restoredPrevious = await page.evaluate(anchor => findSceneInsert(anchor).previousElementSibling.getAttribute('data-test'), savedScenes[1].anchor);
      assert.equal(restoredPrevious, savedScenes[1].previous, 'Incremental restore with another scene already present');

      await page.evaluate(async ({ base64, bookmark }) => {
        await openBook({ base64, fileName: 'scene-layout.epub', lastLocation: bookmark.cfi, settings: { fontSize: 20, lineHeight: 1.5, paragraphSpacing: 12, pageMargin: 16, viewMode: 'paginated', paginatedLayout: 'single' } });
      }, { base64, bookmark: bookmarkBefore });
      await settle(page);
      for (const scene of savedScenes) {
        checkSquare(await measure(page, scene.anchor), `${engine.name()} restored`);
        const previous = await page.evaluate(anchor => findSceneInsert(anchor).previousElementSibling.getAttribute('data-test'), scene.anchor);
        assert.equal(previous, scene.previous, 'Scene returns after the same paragraph');
      }
      const reopenedText = await page.evaluate(bookmark => view.resolveCFI(bookmark.cfi).anchor(getRendererContents()[0].doc).toString(), bookmarkBefore);
      assert.equal(reopenedText, bookmarkBefore.text, 'Bookmark survives reopen and restored scenes');

      const epigraphHost = await page.evaluate(() => {
        const doc = getRendererContents()[0].doc;
        return sceneInsertHostForBlock(doc.querySelector('[data-test="epigraph"]')).className;
      });
      assert.equal(epigraphHost, 'epigraph', 'Do not insert full-width scenes inside a narrow float');
      await page.evaluate(({ anchor, imageDataUri }) => replaceSceneSlot(anchor, imageDataUri), { anchor, imageDataUri });
      await page.evaluate(anchor => view.renderer.scrollToAnchor(findSceneInsert(anchor)), anchor);
      await settle(page);
      await page.evaluate(() => { document.body.style.backgroundColor = '#282828'; });
      await page.screenshot({ path: join(artifacts, `${engine.name()}-scene.png`) });
      const cfiFailures = [];
      page.on('console', msg => { if (msg.type() === 'assert') cfiFailures.push(msg.text()); });
      await page.evaluate(async () => { await import('/foliate/tests/tests.js'); });
      assert.deepEqual(cfiFailures, [], 'Existing Foliate CFI tests');
      assert.deepEqual(pageErrors, [], 'No reader runtime errors');
      console.log(`${engine.name()}: square, page start, state stability, typography, resize, CFI and restore passed`);
    } catch (error) {
      failed = true;
      await page.screenshot({ path: join(artifacts, `${engine.name()}-failure.png`) });
      console.error(error);
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}
console.log(`Artifacts: ${artifacts}`);
if (failed) process.exitCode = 1;

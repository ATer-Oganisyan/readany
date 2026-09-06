/** Native DOM/Range regression; creates/removes its own iframe, never the book. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";
import ts from "typescript";

function productionRuntime() {
  const html = readFileSync(
    new URL("../../assets/reader/reader.template.html", import.meta.url),
    "utf8",
  );
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
  const parsed = ts.createSourceFile(
    "reader.js",
    script,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const names = [
    "doGetVisibleReadingContext",
    "characterNameShouldSkip",
    "markCharacterNamesInBlock",
    "doRemoveCharacterNames",
    "sceneCfiFilter",
  ];
  const methods = names
    .map((name) => {
      const node = parsed.statements.find(
        (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
      );
      if (!node) throw new Error(`Missing production helper ${name}`);
      return node.getText(parsed);
    })
    .join("\n");
  const viewSource = ts.createSourceFile(
    "view.js",
    readFileSync(new URL("../../../foliate-js/view.js", import.meta.url), "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const viewClass = viewSource.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === "View",
  );
  const viewMethods = ["getCFI", "resolveCFI"]
    .map((name) => {
      const method = viewClass?.members.find((member) => member.name?.getText(viewSource) === name);
      if (!method) throw new Error(`Missing View.${name}`);
      return method.getText(viewSource);
    })
    .join("\n");
  const cfi = transformSync(
    readFileSync(new URL("../../../foliate-js/epubcfi.js", import.meta.url), "utf8"),
    { format: "iife", globalName: "CFI" },
  ).code;
  return `${cfi}\n${methods}\nclass ProbeView {${viewMethods}}`;
}

export function readerRichContextExpression() {
  return `(() => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:640px;visibility:hidden;pointer-events:none';
    document.body.appendChild(frame);
    try {
      const doc = frame.contentDocument;
      const NodeFilter = doc.defaultView.NodeFilter;
      const window = { _readanyFindCharacterNameMatches: (text) => Array.from(text.matchAll(/Анна|Борис/g), match => ({start:match.index,end:match.index+match[0].length,characterId:'fixture'})) };
      const CHARACTER_NAME_CLASS = 'readany-character-name';
      const CHARACTER_NAME_ATTR = 'data-readany-character-id';
      const CHARACTER_NAME_BLOCK_ATTR = 'data-readany-charnames';
      const SCENE_INSERT_CLASS = 'readany-scene-insert';
      const _characterNameSpec = {};
      ${productionRuntime()}
      doc.body.innerHTML = '<section><p id="first">OFFSCREEN Анна ' + 'прочитано раньше. '.repeat(12) + 'VISIBLE_START напитку непривычного <em>и видимое выделение</em> рядом.</p><p>Борис сказал <strong>важные слова</strong> тихо.</p><p id="last"><em>Конец</em> <span>последней строки.</span> Он был хмелен, но говорил Анна FUTURE_SECRET никогда не показывать.</p></section>';
      const first = doc.getElementById('first').firstChild;
      const last = doc.getElementById('last').lastChild;
      const range = doc.createRange();
      range.setStart(first, first.nodeValue.indexOf('VISIBLE_START'));
      range.setEnd(last, last.nodeValue.indexOf(' Анна FUTURE_SECRET'));
      const view = new ProbeView();
      view.book = {sections:[{}]};
      view.cfiFilter = sceneCfiFilter;
      view.renderer = {getContents:()=>[{index:0,doc}]};
      const cfi = view.getCFI(0, range);
      view.lastLocation = {range,cfi};
      const getRendererContents = () => view.renderer.getContents();
      const expected = 'VISIBLE_START напитку непривычного и видимое выделение рядом. Борис сказал важные слова тихо. Конец последней строки. Он был хмелен, но говорил';
      const before = doGetVisibleReadingContext();
      for (const p of doc.querySelectorAll('p')) markCharacterNamesInBlock(doc,p);
      const mutatedRangeText = range.toString();
      const wrapped = doGetVisibleReadingContext();
      const resolved = view.resolveCFI(cfi).anchor(doc);
      const roundtripCFI = view.getCFI(0,resolved);
      const liveRange = view.lastLocation.range;
      view.lastLocation.range = resolved;
      const fromImmutableCFI = doGetVisibleReadingContext();
      view.lastLocation.range = liveRange;
      doRemoveCharacterNames(doc);
      const unwrapped = doGetVisibleReadingContext();
      const errors = [];
      for (const [stage, value] of Object.entries({before,wrapped,unwrapped})) {
        if (value?.text !== expected || value?.cfi !== cfi) errors.push(stage + ': wrong exact viewport text or CFI');
      }
      if (roundtripCFI !== cfi) errors.push('CFI changed under transparent wrappers');
      return {passed:!errors.length,errors,cfi,expected,before,wrapped,unwrapped,fromImmutableCFI,mutatedRangeText,roundtripCFI};
    } finally { frame.remove(); }
  })()`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes("--print-expression"))
    throw new Error("Use --print-expression in the existing native WebView");
  console.log(readerRichContextExpression());
}

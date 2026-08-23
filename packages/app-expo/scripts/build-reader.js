/**
 * Build script to bundle foliate-js into a self-contained reader.html
 * for use in React Native WebView.
 *
 * Run: node scripts/build-reader.js
 */
const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const FOLIATE_DIR = path.resolve(__dirname, "../../foliate-js");
const CHARACTER_NAME_MATCHER = path.resolve(
  __dirname,
  "../src/lib/narra/character-name-matcher.ts",
);
const ASSETS_DIR = path.resolve(__dirname, "../assets/reader");
const TEMPLATE = path.resolve(ASSETS_DIR, "reader.template.html");
const OUTPUT = path.resolve(ASSETS_DIR, "reader.html");
const INTERFACE_FONT = path.resolve(
  __dirname,
  "../../deslop-primitives/fonts/SBSansUI-Regular.otf",
);

const FOLIATE_PDF = path.resolve(FOLIATE_DIR, "pdf.js");

/**
 * pdf.js — почти девять десятых кода ридера (движок pdfjs-dist вместе с его
 * воркером). В исходниках он и так грузится через `await import()`, но формат
 * iife не умеет отдельные чанки, поэтому esbuild вплавлял его в общий бандл и
 * WebView компилировал его при открытии любой книги, включая EPUB.
 *
 * Здесь он собирается отдельно и попадает в HTML строкой: парсер её только
 * пробегает, а компиляция происходит при первом обращении к PDF.
 */
const pdfDeferPlugin = {
  name: "readany-defer-pdf",
  setup(build) {
    build.onResolve({ filter: /(^|\/)pdf\.js$/ }, (args) => {
      const resolved = path.resolve(args.resolveDir, args.path);
      if (resolved !== FOLIATE_PDF) return null;
      return { path: resolved, namespace: "readany-pdf-shim" };
    });

    build.onLoad({ filter: /.*/, namespace: "readany-pdf-shim" }, () => ({
      contents: `
        const load = () => globalThis.__readanyLoadPDF();
        export const makePDF = async (...args) => (await load()).makePDF(...args);
        export const makePDFFromURL = async (...args) => (await load()).makePDFFromURL(...args);
        export const extractPDFChapters = async (...args) => (await load()).extractPDFChapters(...args);
      `,
      loader: "js",
    }));
  },
};

const SHARED_BUILD_OPTIONS = {
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  write: false,
  resolveExtensions: [".js", ".mjs"],
};

async function bundle(entryContent, fileName, plugins = []) {
  const entryFile = path.resolve(__dirname, `../${fileName}`);
  fs.writeFileSync(entryFile, entryContent);
  try {
    const result = await esbuild.build({
      ...SHARED_BUILD_OPTIONS,
      entryPoints: [entryFile],
      plugins,
    });
    return result.outputFiles[0].text;
  } finally {
    if (fs.existsSync(entryFile)) fs.unlinkSync(entryFile);
  }
}

/** Строковый литерал для вставки в <script>: `</` внутри закрыл бы тег. */
function toScriptSafeStringLiteral(source) {
  return JSON.stringify(source).split("</").join("<\\/");
}

async function buildReader() {
  const foliate = FOLIATE_DIR.replace(/\\/g, "/");

  const mainEntry = `
    import { makeBook, View } from "${foliate}/view.js";
    import { Overlayer } from "${foliate}/overlayer.js";
    import * as CFI from "${foliate}/epubcfi.js";
    import { configure, ZipReader, BlobReader, TextWriter, BlobWriter } from "${foliate}/vendor/zip.js";
    import { EPUB } from "${foliate}/epub.js";
    import { extractPDFChapters, makePDFFromURL } from "${foliate}/pdf.js";
    import { findCharacterNameMatches } from "${CHARACTER_NAME_MATCHER.replace(/\\/g, "/")}";

    window.makeBook = makeBook;
    // Матчер имён персонажей Narra — единая логика с RN-стороной (юниты рядом с модулем)
    window._readanyFindCharacterNameMatches = findCharacterNameMatches;
    window.Overlayer = Overlayer;
    window.CFI = CFI;

    // Expose zip.js and EPUB for lazy Range-based loading in reader template
    window._zipJs = { configure, ZipReader, BlobReader, TextWriter, BlobWriter };
    window._EPUB = EPUB;
    window._makePDFFromURL = makePDFFromURL;
    window._extractPDFChapters = extractPDFChapters;

    if (!customElements.get('foliate-view')) {
      customElements.define('foliate-view', View);
    }

    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'foliate-loaded' }));
    }
  `;

  const pdfEntry = `
    import { makePDF, makePDFFromURL, extractPDFChapters } from "${foliate}/pdf.js";
    globalThis.__readanyPDF = { makePDF, makePDFFromURL, extractPDFChapters };
  `;

  const [mainJS, pdfJS] = await Promise.all([
    bundle(mainEntry, ".foliate-entry.mjs", [pdfDeferPlugin]),
    bundle(pdfEntry, ".foliate-pdf-entry.mjs"),
  ]);

  const pdfLoaderJS = `
    window.__readanyPDFSource = ${toScriptSafeStringLiteral(pdfJS)};
    window.__readanyLoadPDF = function () {
      if (!window.__readanyPDFPromise) {
        window.__readanyPDFPromise = new Promise(function (resolve, reject) {
          try {
            var source = window.__readanyPDFSource;
            if (!source) throw new Error('PDF engine source is missing');
            new Function(source)();
            // Строка больше не нужна: движок уже в памяти как код.
            window.__readanyPDFSource = '';
            resolve(window.__readanyPDF);
          } catch (error) {
            window.__readanyPDFPromise = null;
            reject(error);
          }
        });
      }
      return window.__readanyPDFPromise;
    };
  `;

  // Read the template HTML (never modified)
  const template = fs
    .readFileSync(TEMPLATE, "utf-8")
    .replace(
      "__READANY_SB_SANS_INTERFACE_REGULAR_DATA_URL__",
      `data:font/otf;base64,${fs.readFileSync(INTERFACE_FONT).toString("base64")}`,
    );

  // Replace the placeholder with the bundled code
  // Use split/join instead of replace to avoid $ replacement patterns in JS bundle
  const MARKER = "<!-- __READANY_FOLIATE_BUNDLE_INSERT_POINT_7f3a9b2e__ -->";
  const parts = template.split(MARKER);
  const html = `${parts[0]}<script>\n${pdfLoaderJS}\n</script>\n<script>\n${mainJS}\n</script>${parts
    .slice(1)
    .join(MARKER)}`;

  fs.writeFileSync(OUTPUT, html);
  console.log(
    `Built reader.html (${Math.round(html.length / 1024)}KB; ` +
      `code ${Math.round(mainJS.length / 1024)}KB + deferred PDF ${Math.round(pdfJS.length / 1024)}KB)`,
  );
}

buildReader().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});

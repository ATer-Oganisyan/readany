/**
 * Build script to bundle foliate-js into a self-contained reader.html
 * for use in React Native WebView.
 *
 * Run: node scripts/build-reader.js
 */
const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const FOLIATE_DIR = path.resolve(__dirname, "../../foliate-js");
const CHARACTER_NAME_MATCHER = path.resolve(
  __dirname,
  "../src/lib/narra/character-name-matcher.ts",
);
const COVER_PRESS_CONFIG = path.resolve(__dirname, "../src/components/library/cover-press-config.ts");
const SCENE_PIXEL_LOADER = path.resolve(__dirname, "../src/lib/reader/scene-pixel-loader.ts");
const ASSETS_DIR = path.resolve(__dirname, "../assets/reader");
const TEMPLATE = path.resolve(ASSETS_DIR, "reader.template.html");
const OUTPUT = path.resolve(ASSETS_DIR, "reader.html");
const PDF_OUTPUT = path.resolve(ASSETS_DIR, "reader-pdf.bin");
const BUILD_MANIFEST = path.resolve(ASSETS_DIR, "reader-build.json");

function writeIfChanged(file, contents) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === contents) return;
  fs.writeFileSync(file, contents);
}
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
 * Здесь он собирается в отдельный asset и вообще не попадает в HTML EPUB-
 * ридера. WebView скачивает и компилирует его только при открытии PDF.
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
    import { COVER_PRESS_FEEDBACK } from "${COVER_PRESS_CONFIG.replace(/\\/g, "/")}";
    import { mountScenePixelLoader } from "${SCENE_PIXEL_LOADER.replace(/\\/g, "/")}";

    window.makeBook = makeBook;
    window._readanyCoverPressFeedback = COVER_PRESS_FEEDBACK;
    window._readanyMountScenePixelLoader = mountScenePixelLoader;
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
    window.__readanyLoadPDF = function () {
      if (!window.__readanyPDFPromise) {
        window.__readanyPDFPromise = (async function () {
          try {
            var uri = window.__readanyPDFAssetUri;
            if (!uri) throw new Error('PDF engine URI is missing');
            var response = await fetch(uri);
            var isLocalFileStatus = response.status === 0 && /^file:\\/\\//i.test(uri);
            if (!response.ok && !isLocalFileStatus) {
              throw new Error('Failed to fetch PDF engine: ' + response.status);
            }
            var source = await response.text();
            new Function(source)();
            return window.__readanyPDF;
          } catch (error) {
            window.__readanyPDFPromise = null;
            throw error;
          }
        })();
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
  const sceneEffectLicense = fs.readFileSync(path.join(ASSETS_DIR, "img-fx.LICENSE.txt"), "utf8");
  const html = `${parts[0]}<script>\n${pdfLoaderJS}\n</script>\n<script>\n/*!\n${sceneEffectLicense}\n*/\n${mainJS}\n</script>${parts
    .slice(1)
    .join(MARKER)}`;

  writeIfChanged(OUTPUT, html);
  writeIfChanged(PDF_OUTPUT, pdfJS);
  // Update a JS dependency too, so Metro notices rebuilt non-JS reader assets.
  writeIfChanged(
    BUILD_MANIFEST,
    `${JSON.stringify({ htmlMd5: crypto.createHash("md5").update(html).digest("hex") }, null, 2)}\n`,
  );
  console.log(
    `Built reader.html (${Math.round(html.length / 1024)}KB; ` +
      `code ${Math.round(mainJS.length / 1024)}KB) + ` +
      `reader-pdf.bin (${Math.round(pdfJS.length / 1024)}KB, lazy)`,
  );
}

buildReader().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});

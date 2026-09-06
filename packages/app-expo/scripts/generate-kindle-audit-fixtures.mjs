#!/usr/bin/env node
// Optional extension to generate-import-audit-fixtures.mjs. Requires a real,
// locally installed Calibre ebook-convert; never downloads or installs one.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const converter = process.argv[2];
if (!converter) throw new Error("Usage: node generate-kindle-audit-fixtures.mjs /path/to/ebook-convert [fixture-directory]");
const root = resolve(process.argv[3] ?? "/private/tmp/narra-audit-import-fixtures");
const source = join(root, "01-river.epub");
const manifestPath = join(root, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const staging = mkdtempSync(join(tmpdir(), "narra-kindle-fixtures-"));
const fixtures = [
  { name: "23-river.mobi", title: "Аудит 23 - Письмо MOBI", version: 6 },
  { name: "24-river.azw3", title: "Аудит 24 - Письмо AZW3", version: 8 },
  { name: "25-river.azw", title: "Аудит 25 - Письмо AZW", version: 6 },
];
try {
  for (const fixture of fixtures) {
    const output = join(staging, fixture.version === 8 ? "book.azw3" : "book.mobi");
    const options = fixture.version === 6 ? ["--mobi-file-type", "old"] : [];
    execFileSync(converter, [source, output, "--title", fixture.title, ...options], {
      stdio: "inherit", timeout: 60_000,
    });
    const bytes = readFileSync(output);
    if (bytes.subarray(60, 68).toString("ascii") !== "BOOKMOBI") {
      throw new Error(`Converter did not produce a real PalmDB/MOBI container: ${fixture.name}`);
    }
    // AZW here is explicitly the DRM-free MOBI6 extension route, not DRM/KFX.
    copyFileSync(output, join(root, fixture.name));
    const entry = {
      name: fixture.name, title: fixture.title, expectation: "import-read",
      bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
      container: fixture.version === 8 ? "KF8/MOBI8" : "DRM-free MOBI6",
      checks: ["real-palmdb-container", "original-text", "cyrillic", "chapter-navigation"],
    };
    manifest.fixtures = manifest.fixtures.filter((item) => item.name !== fixture.name);
    manifest.fixtures.push(entry);
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

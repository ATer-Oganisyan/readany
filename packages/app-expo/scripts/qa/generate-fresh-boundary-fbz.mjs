#!/usr/bin/env node
// A distinct original-book variant for cold chapter-cache QA; no existing fixture is overwritten.
import { readFileSync, writeFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const directory = "/private/tmp/narra-audit-import-fixtures";
const output = `${directory}/27-fresh-boundary.fbz`;
const entries = unzipSync(readFileSync(`${directory}/08-archive.fbz`));
const name = Object.keys(entries).find((name) => /\.fb2$/i.test(name));
if (!name) throw new Error("The original FBZ must contain a real FB2");
const original = strFromU8(entries[name]);
const changed = original.replace(
  /<book-title>[^<]+<\/book-title>/,
  "<book-title>Аудит 27 - Граница глав</book-title>",
);
if (changed === original) throw new Error("Original FB2 title not found");
entries[name] = strToU8(changed);
// Match the recorded original ZIP DOS timestamp, independently of the host timezone.
writeFileSync(output, zipSync(entries, { mtime: new Date(2026, 8, 5, 12, 22, 26) }), {
  flag: "wx",
});
console.log(JSON.stringify({ output, title: "Аудит 27 - Граница глав" }));

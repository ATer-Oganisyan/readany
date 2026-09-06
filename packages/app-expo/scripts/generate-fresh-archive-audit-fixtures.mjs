#!/usr/bin/env node
// Distinct packaging of our own audit stories exercises a genuinely new import.
// Original fixtures and their hashes are never overwritten.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { unzipSync, zipSync } from "fflate";

const source = resolve(process.argv[2] || "/private/tmp/narra-audit-import-fixtures");
const output = resolve(process.argv[3] || "/private/tmp/narra-audit-fresh-import");
if (source === output) throw new Error("Fresh fixtures require a separate output directory");
mkdirSync(output, { recursive: true });
const sourceManifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
const fixtures = [
  ["08-archive.fbz", "27-fresh-metadata.fbz"],
  ["09-nested.fb2.zip", "28-fresh-nested.fb2.zip"],
].map(([original, name]) => {
  const bytes = zipSync(unzipSync(readFileSync(join(source, original))), {
    level: 0,
    mtime: new Date("2026-09-05T12:00:00Z"),
  });
  writeFileSync(join(output, name), bytes, { flag: "wx" });
  return {
    ...sourceManifest.fixtures.find((fixture) => fixture.name === original),
    name,
    original,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
});
writeFileSync(join(output, "manifest.json"), JSON.stringify({ fixtures }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ output, fixtures }, null, 2));

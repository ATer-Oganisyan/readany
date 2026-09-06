#!/usr/bin/env node
// Assert real native observations; no app mutations. Pass baseline stack,
// AFTER stack, and AFTER reader-position JSONL for one physical PDF note return.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [beforePath, afterPath, positionPath] = process.argv.slice(2);
if (!beforePath || !afterPath || !positionPath || process.argv.length !== 5)
  throw new Error("Pass baseline-stack.json after-stack.json after-position.jsonl");
const before = JSON.parse(readFileSync(beforePath, "utf8")).navigation;
const after = JSON.parse(readFileSync(afterPath, "utf8")).navigation;
const positions = readFileSync(positionPath, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const ownPdf = "e243bab5-5ee3-439e-a40e-8b4e5b2e8078";
for (const state of [before, after]) {
  assert.deepEqual(
    state.routes.map((route) => route.name),
    ["Tabs", "Reader"],
  );
  assert.equal(state.index, 1);
  assert.equal(state.routes[1].bookId, ownPdf);
}
assert.equal(after.routes[1].key, before.routes[1].key, "Must reuse the same Reader instance");
assert.equal(positions[0].initial.cfi, "epubcfi(/6/6)");
assert.equal(positions.at(-1).settled.cfi, "epubcfi(/6/6)");
assert.equal(positions.at(-1).settled.chapter, "Page 3");
console.log(
  JSON.stringify({
    passed: true,
    sameReaderKey: after.routes[1].key,
    routes: after.routes.map((route) => route.name),
    cfi: positions.at(-1).settled.cfi,
  }),
);

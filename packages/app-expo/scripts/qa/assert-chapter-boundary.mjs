#!/usr/bin/env node
// Assert the three-linear-chapter original FBZ flow from android-reader-position.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

assert.ok(
  process.argv.length === 3 || (process.argv.length === 4 && process.argv[3] === "--reverse"),
  "Pass one native position JSONL artifact and optionally --reverse",
);
const reverse = process.argv[3] === "--reverse";
const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map(JSON.parse);
const visited = [];
for (const row of rows) {
  const state = row.initial ?? row.settled ?? row;
  const match = /^epubcfi\(\/6\/(\d+)!/.exec(state.cfi ?? "");
  assert.ok(match, "Every observation needs a real section CFI");
  const chapter = Number(match[1]) / 2;
  if (visited.at(-1) !== chapter) visited.push(chapter);
  if (row.turn) assert.equal(row.changed, true, `Tap ${row.turn} must advance`);
}
if (!reverse) assert.equal(visited[0], 1, "The forward flow must begin in chapter one");
assert.ok(visited.length > 1, "The observations must cross a chapter boundary");
for (let index = 1; index < visited.length; index++) {
  assert.equal(
    visited[index],
    visited[index - 1] + (reverse ? -1 : 1),
    "Never skip a linear chapter",
  );
}
console.log(JSON.stringify({ passed: true, visitedChapters: visited, observations: rows.length }));

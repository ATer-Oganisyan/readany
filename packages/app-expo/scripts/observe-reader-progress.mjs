#!/usr/bin/env node
// Read-only native QA evidence: observe actual app snapshots, never inject state.
// Usage: node scripts/observe-reader-progress.mjs /path/to/reader-context.json 45
import { readFileSync } from "node:fs";

const [snapshotPath, seconds = "45"] = process.argv.slice(2);
const duration = Number(seconds) * 1000;
if (!snapshotPath || !Number.isFinite(duration) || duration < 1000 || duration > 300000) {
  throw new Error("Provide a reader-context.json path and a duration between 1 and 300 seconds");
}
const startedAt = Date.now();
let previous;
let transitions = 0;
const timer = setInterval(() => {
  try {
    const state = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const position = {
      bookId: state.bookId,
      cfi: state.currentPosition?.cfi,
      percentage: state.currentPosition?.percentage,
      chapter: state.currentChapter?.title,
    };
    const signature = JSON.stringify(position);
    if (signature !== previous) {
      previous = signature;
      transitions += 1;
      console.log(JSON.stringify({ elapsedMs: Date.now() - startedAt, ...position }));
    }
  } catch {
    // Snapshot may be absent or mid-write. Observe the next atomic readable state.
  }
  if (Date.now() - startedAt >= duration) {
    clearInterval(timer);
    console.log(JSON.stringify({ complete: true, positionsObserved: transitions }));
  }
}, 50);

#!/usr/bin/env node
// Bounded physical-keyboard QA input. Never saves a note or edits app storage.
// The original two QA notes must already be open in the inline editor.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const adb = process.env.ANDROID_ADB ?? "adb";
const serial = process.env.ANDROID_SERIAL ?? "emulator-5554";
const appId = "com.mishanaer.readany.dev";
const marker = "NARRA_ANDROID_QA_BOOK_SCOPE_20260905_EDITED";
const secondMarker = "NARRA_ANDROID_QA_BOOK_SCOPE_20260905_SECOND";
const android = (...args) =>
  execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 30000 });
function focusedEditor() {
  android("shell", "uiautomator", "dump", "/sdcard/NarraAuditNotesUI.xml");
  const xml = android("shell", "cat", "/sdcard/NarraAuditNotesUI.xml");
  assert.ok(xml.includes(secondMarker), "Only the original QA notebook is in scope");
  const node = (xml.match(/<node[^>]+>/g) ?? []).find(
    (item) =>
      item.includes('class="android.widget.EditText"') &&
      item.includes(`package="${appId}"`) &&
      item.includes('focused="true"'),
  );
  assert.ok(node, "Focus the original QA note inline editor first");
  return node.match(/\btext="([^"]*)"/)?.[1];
}
const before = focusedEditor();
assert.ok(before?.startsWith("NARR"), "Refusing to replace non-QA text");
console.log(JSON.stringify({ before, expected: marker }));
android("shell", "input", "keycombination", "113", "29");
// Android pre-timestamps a whole `input text` batch. On an overloaded debug
// emulator long batches can expire in InputDispatcher before reaching the app.
// Each short command creates fresh physical events; this is not a speed test.
for (let offset = 0; offset < marker.length; offset += 2) {
  const chunk = marker.slice(offset, offset + 2);
  const started = Date.now();
  android("shell", "input", "text", chunk);
  console.log(JSON.stringify({ offset, chunk, elapsedMs: Date.now() - started }));
}
const after = focusedEditor();
console.log(JSON.stringify({ after, exact: after === marker }));
assert.equal(after, marker, "The native editor must retain every inserted character");

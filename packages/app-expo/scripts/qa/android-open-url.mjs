#!/usr/bin/env node
// Native UI driver for localhost fixture URLs, without changing app state via JS.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const adb = process.env.ANDROID_ADB ?? "adb";
const serial = process.env.ANDROID_SERIAL ?? "emulator-5554";
const url = new URL(process.argv[2]);
assert.equal(
  url.origin,
  "http://127.0.0.1:8099",
  "Only the local original-book QA server is allowed",
);
const android = (...args) =>
  execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 15000 });
function hierarchy() {
  const path = `/data/local/tmp/narra-url-native-${Date.now()}.xml`;
  assert.match(android("shell", "uiautomator", "dump", path), /dumped to/);
  return (android("exec-out", "cat", path).match(/<node\s[^>]+>/g) ?? []).map((node) =>
    Object.fromEntries(
      [...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
    ),
  );
}
async function find(label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let nodes;
    try {
      nodes = hierarchy();
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    const node = nodes.find(
      (item) =>
        (item.text === label || item["content-desc"] === label || item["resource-id"] === label) &&
        item.bounds !== "[0,0][0,0]",
    );
    if (node) return node;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Visible native control not found: ${label}`);
}
async function tap(label) {
  const node = await find(label);
  const [left, top, right, bottom] = node.bounds.match(/\d+/g).map(Number);
  android(
    "shell",
    "input",
    "tap",
    String(Math.round((left + right) / 2)),
    String(Math.round((top + bottom) / 2)),
  );
  console.log(JSON.stringify({ tapped: label, at: new Date().toISOString() }));
}
await find("Library");
await tap("Add book");
await tap("Add from link");
await find("Book link");
await tap("Book file or Ficbook story link");
android("shell", "input", "text", url.toString());
// Android's synthetic input can drop trailing keys while the keyboard settles.
// Never confirm a different URL: only complete an observed exact prefix.
for (let attempt = 0; attempt < 3; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 350));
  const field = hierarchy().find((node) => node.class === "android.widget.EditText");
  assert.ok(field, "URL field disappeared before confirmation");
  if (field.text === url.toString()) break;
  assert.ok(field.text && url.toString().startsWith(field.text), "Native URL differs from input");
  android("shell", "input", "text", url.toString().slice(field.text.length));
}
await find(url.toString());
console.log(JSON.stringify({ entered: url.toString() }));
if (!process.argv.includes("--prepare")) await tap("android:id/button1");

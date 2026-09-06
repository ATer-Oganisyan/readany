#!/usr/bin/env node
// Behavioral layout guard against the real, currently displayed Android dialog.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const adb = process.env.ANDROID_ADB ?? "adb";
const serial = process.env.ANDROID_SERIAL ?? "emulator-5554";
const android = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8" });
const density = Number(
  android("shell", "wm", "density")
    .match(/(?:Override|Physical) density: (\d+)/g)
    ?.at(-1)
    ?.match(/\d+/)?.[0],
);
assert.ok(density > 0, "Android display density is known");
const path = `/data/local/tmp/narra-url-layout-${Date.now()}.xml`;
const result = android("shell", "uiautomator", "dump", path);
assert.match(result, /dumped to/, "A fresh hierarchy is required; never inspect a stale dump");
const xml = android("exec-out", "cat", path);
const nodes = (xml.match(/<node\s[^>]+>/g) ?? []).map((node) =>
  Object.fromEntries(
    [...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
  ),
);
const field = nodes.find(
  (node) =>
    node.class === "android.widget.EditText" && node.package === "com.mishanaer.readany.dev",
);
assert.ok(field, "The actual native URL input is displayed");
const bounds = field.bounds.match(/\d+/g).map(Number);
const heightPx = bounds[3] - bounds[1];
const heightDp = heightPx / (density / 160);
console.log(JSON.stringify({ density, heightPx, heightDp, bounds, text: field.text }));
assert.ok(
  heightDp >= 48,
  `URL input must have at least 48dp height; observed ${heightDp.toFixed(2)}dp`,
);
for (const id of ["android:id/button1", "android:id/button2"]) {
  const button = nodes.find((node) => node["resource-id"] === id);
  assert.ok(
    button?.enabled === "true" && button.bounds !== "[0,0][0,0]",
    `${id} is enabled and visible`,
  );
}

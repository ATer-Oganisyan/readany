#!/usr/bin/env node
// Prepared native URL prompt only. OCR avoids UIAutomator's idle wait outliving a toast.
// Requires: swiftc -O native-toast-ocr.swift -o /private/tmp/narra-native-toast-ocr
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";

const adb = process.env.ANDROID_ADB ?? "adb";
const action = process.argv.includes("--cancel") ? "Cancel" : "Details";
const directory = mkdtempSync("/private/tmp/narra-toast-qa-");
const android = (...args) =>
  execFileSync(adb, ["-s", "emulator-5554", ...args], { timeout: 12000 });
const screenshot = (name) => {
  const path = `${directory}/${name}.png`;
  writeFileSync(path, android("exec-out", "screencap", "-p"));
  return path;
};
console.log(JSON.stringify({ directory, action, startedAt: Date.now() }));
android("shell", "input", "tap", "893", "1010");
const started = Date.now();
let found;
for (let attempt = 0; Date.now() - started < 25000; attempt++) {
  const before = screenshot(`before-${attempt}`);
  const matches = JSON.parse(
    execFileSync("/private/tmp/narra-native-toast-ocr", [before, action], {
      encoding: "utf8",
      timeout: 5000,
    }),
  );
  // Only the bottom import toast, never the native prompt's own Cancel button.
  found = matches.find((match) => match.top > 1600 && match.bottom < 2150);
  if (!found) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    continue;
  }
  const point = [
    Math.round((found.left + found.right) / 2),
    Math.round((found.top + found.bottom) / 2),
  ];
  console.log(JSON.stringify({ before, found, point, tappedAt: Date.now() }));
  android("shell", "input", "tap", ...point.map(String));
  await new Promise((resolve) => setTimeout(resolve, 900));
  console.log(JSON.stringify({ after: screenshot("after"), observedAt: Date.now() }));
  break;
}
if (!found) throw new Error(`${action} was not visually found in 25 seconds`);

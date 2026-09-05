#!/usr/bin/env node
// A bounded debug-runtime observation, not a release memory benchmark.
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const adb = process.env.ANDROID_ADB ?? "adb";
const serial = process.env.ANDROID_SERIAL ?? "emulator-5554";
const appId = "com.mishanaer.readany.dev";
const cycles = Number(process.argv.find((arg) => arg.startsWith("--cycles="))?.split("=")[1] ?? 5);
if (!Number.isInteger(cycles) || cycles < 1 || cycles > 10) throw new Error("Use --cycles=1..10");
const cwd = fileURLToPath(new URL("../../", import.meta.url));
const android = (...args) =>
  execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 15000 });
function observation(cycle) {
  const dump = android("shell", "dumpsys", "meminfo", appId);
  const books = JSON.parse(
    android("exec-out", "run-as", appId, "cat", "files/readany-store/library-books.json"),
  );
  const book = books.find((item) => item.meta.title === "26-mixed-recovery");
  const heap = dump
    .match(/^\s*Native Heap\s+(.+)$/m)?.[1]
    ?.trim()
    .split(/\s+/)
    .map(Number);
  console.log(
    JSON.stringify({
      cycle,
      at: new Date().toISOString(),
      pid: android("shell", "pidof", appId).trim(),
      nativeHeapRow: heap,
      totalPssKB: Number(dump.match(/TOTAL PSS:\s*(\d+)/)?.[1]),
      totalRssKB: Number(dump.match(/TOTAL RSS:\s*(\d+)/)?.[1]),
      views: Number(dump.match(/Views:\s*(\d+)/)?.[1]),
      webViews: Number(dump.match(/WebViews:\s*(\d+)/)?.[1]),
      book: book && { id: book.id, cfi: book.currentCfi, progress: book.progress },
    }),
  );
}
observation(0);
for (let cycle = 1; cycle <= cycles; cycle++) {
  const started = Date.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      "maestro",
      ["--device", serial, "test", ".maestro/android-small-book-soak-cycle.yaml"],
      {
        cwd,
        env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let log = "";
    child.stdout.on("data", (data) => {
      log += data;
    });
    child.stderr.on("data", (data) => {
      log += data;
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), 120000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, log });
    });
  });
  console.log(JSON.stringify({ cycle, elapsedDriverMs: Date.now() - started, ...result }));
  if (result.code !== 0) {
    process.exitCode = 1;
    break;
  }
  observation(cycle);
}

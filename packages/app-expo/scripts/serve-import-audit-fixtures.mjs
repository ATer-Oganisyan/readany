#!/usr/bin/env node
import { createReadStream, readFileSync, statSync } from "node:fs";
// Localhost only. Android: adb reverse tcp:8099 tcp:8099. Never a public tunnel.
import { createServer } from "node:http";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] || "/private/tmp/narra-audit-import-fixtures");
const port = Number(process.argv[3] || 8099);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local QA port");
const fixtures = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).fixtures;
const names = new Set(fixtures.map((f) => f.name));
const types = {
  epub: "application/epub+zip",
  fb2: "application/x-fictionbook+xml",
  txt: "text/plain",
  pdf: "application/pdf",
  cbz: "application/vnd.comicbook+zip",
  fbz: "application/zip",
  zip: "application/zip",
  umd: "application/octet-stream",
};
createServer((req, res) => {
  let name;
  try {
    name = decodeURIComponent(new URL(req.url, "http://127.0.0.1:8099").pathname.slice(1));
  } catch {
    res.writeHead(400).end("Invalid path");
    return;
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), method: req.method, path: name }));
  if (name === "redirect.epub") {
    res.writeHead(302, { Location: "/01-river.epub" }).end();
    return;
  }
  if (name === "error.epub") {
    res.writeHead(503).end("Fixture: service unavailable");
    return;
  }
  if (name === "stall.epub") {
    res.writeHead(200, { "Content-Type": types.epub, "Content-Length": "999999" });
    res.write("PK");
    const timer = setTimeout(() => res.destroy(), 90_000);
    res.on("close", () => clearTimeout(timer));
    return;
  }
  if (name === "") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(fixtures));
    return;
  }
  if (!names.has(name)) {
    res.writeHead(404).end("Fixture not found");
    return;
  }
  const file = join(root, name);
  res.writeHead(200, {
    "Content-Type": types[name.split(".").at(-1).toLowerCase()] || "application/octet-stream",
    "Content-Length": statSync(file).size,
  });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () =>
  console.log(`Narra import fixtures: http://127.0.0.1:${port} (loopback only)`),
);

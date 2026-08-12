#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_CATALOG_BOOK_DEFINITIONS } from "../src/lib/catalog/bundled-book-definitions";
import { getBundledCatalogCharactersById } from "../src/lib/narra/bundled-catalog-characters";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(APP_DIR, ".tmp", "catalog-portrait-comparison");
const OLD_DIR = path.join(OUTPUT_DIR, "old");
const NEW_DIR = path.join(OUTPUT_DIR, "new");

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

async function main(): Promise<void> {
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await Promise.all([mkdir(OLD_DIR, { recursive: true }), mkdir(NEW_DIR, { recursive: true })]);

  const cards: string[] = [];
  for (const book of BUNDLED_CATALOG_BOOK_DEFINITIONS) {
    for (const character of getBundledCatalogCharactersById(book.id) ?? []) {
      const relativePath = `${book.id}/${character.id}.jpg`;
      const oldPath = path.join(OLD_DIR, relativePath);
      const newPath = path.join(NEW_DIR, relativePath);
      await Promise.all([
        mkdir(path.dirname(oldPath), { recursive: true }),
        mkdir(path.dirname(newPath), { recursive: true }),
      ]);
      try {
        const oldBytes = execFileSync("git", [
          "show",
          `HEAD:packages/app-expo/assets/catalog/characters/${relativePath}`,
        ]);
        await writeFile(oldPath, oldBytes);
      } catch {
        await writeFile(
          oldPath,
          await readFile(path.join(APP_DIR, "assets/catalog/characters", relativePath)),
        );
      }
      await writeFile(
        newPath,
        await readFile(path.join(APP_DIR, "assets/catalog/characters", relativePath)),
      );
      const unchanged = character.id === "buratino";
      cards.push(`
        <article class="card" data-book="${escapeHtml(book.title)}" data-name="${escapeHtml(character.fullName)}">
          <header><div><p>${escapeHtml(book.title)}</p><h2>${escapeHtml(character.fullName)}</h2></div>${unchanged ? '<span class="badge">без изменений</span>' : ""}</header>
          <div class="pair">
            <figure><figcaption>До</figcaption><img loading="lazy" src="old/${relativePath}" alt="Старый портрет: ${escapeHtml(character.fullName)}"></figure>
            <figure><figcaption>После</figcaption><img loading="lazy" src="new/${relativePath}" alt="Новый портрет: ${escapeHtml(character.fullName)}"></figure>
          </div>
        </article>`);
    }
  }

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Портреты персонажей — до / после</title><style>
  :root{color-scheme:light;--paper:#f1ede3;--ink:#171714;--muted:#746f63;--line:#c8c0af;--accent:#e65f31}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Georgia,serif}main{width:min(1440px,calc(100% - 32px));margin:auto;padding:48px 0 80px}nav{position:sticky;top:0;z-index:3;padding:16px 0;background:linear-gradient(var(--paper) 78%,transparent)}h1{font-size:clamp(36px,5vw,72px);font-weight:400;line-height:.95;margin:0 0 16px;letter-spacing:-.045em}.summary{color:var(--muted);font:14px ui-monospace,monospace;margin:0 0 24px}.controls{display:flex;gap:10px}.controls input{width:min(520px,100%);border:1px solid var(--line);border-radius:999px;background:#fffaf0;padding:13px 18px;font:16px Georgia,serif;outline:none}.controls input:focus{border-color:var(--ink)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(460px,1fr));gap:18px}.card{background:#fffaf0;border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(42,34,20,.08)}.card header{display:flex;justify-content:space-between;gap:16px;align-items:start;padding:18px 20px;border-bottom:1px solid var(--line)}.card p{margin:0 0 5px;color:var(--muted);font:11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em}.card h2{font-size:20px;font-weight:400;margin:0}.badge{font:10px ui-monospace,monospace;text-transform:uppercase;background:#2b2821;color:white;padding:6px 8px;border-radius:999px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line)}figure{margin:0;position:relative;background:#ddd}figcaption{position:absolute;z-index:1;top:10px;left:10px;background:rgba(20,18,14,.8);color:white;border-radius:999px;padding:6px 10px;font:11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em}img{width:100%;aspect-ratio:3/4;display:block;object-fit:cover}.hidden{display:none}@media(max-width:600px){main{width:min(100% - 20px,1440px);padding-top:28px}.grid{grid-template-columns:1fr}.card header{padding:14px}.card h2{font-size:17px}}
  </style></head><body><main><nav><h1>Персонажи.<br>До / после.</h1><p class="summary">93 портрета · 92 перегенерированы · Буратино сохранён из-за safety-отказа</p><div class="controls"><input id="search" type="search" placeholder="Книга или персонаж…" aria-label="Фильтр"></div></nav><section class="grid">${cards.join("")}</section></main><script>const input=document.querySelector('#search');const cards=[...document.querySelectorAll('.card')];input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();for(const card of cards){const haystack=(card.dataset.book+' '+card.dataset.name).toLowerCase();card.classList.toggle('hidden',Boolean(q)&&!haystack.includes(q));}});</script></body></html>`;
  await writeFile(path.join(OUTPUT_DIR, "index.html"), html);
  console.log(OUTPUT_DIR);
}

void main();

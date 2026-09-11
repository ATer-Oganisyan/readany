import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { allowReaderNavigation } from "./reader-navigation";

const shell = "http://127.0.0.1:8088/reader/reader.html";

describe("reader navigation", () => {
  it.each([
    "https://ru.wiktionary.org/wiki/сюртук",
    "https://ru.wikisource.org/wiki/Бригадир",
    "https://example.org/",
    "javascript:alert(1)",
    "mailto:example@example.org",
    "http://127.0.0.1:8088.evil.example/",
    "invalid URL",
  ])("blocks external and executable navigation: %s", (url) => {
    expect(allowReaderNavigation({ url }, shell)).toBe(false);
    expect(allowReaderNavigation({ url, isTopFrame: true }, shell)).toBe(false);
  });

  it("keeps the shell, chapter frames and fragment navigation available", () => {
    expect(allowReaderNavigation({ url: shell, isTopFrame: true }, shell)).toBe(true);
    expect(allowReaderNavigation({ url: `${shell}#chapter` }, shell)).toBe(true);
    expect(
      allowReaderNavigation(
        { url: "blob:http://127.0.0.1:8088/chapter", isTopFrame: false },
        shell,
      ),
    ).toBe(true);
    expect(allowReaderNavigation({ url: "about:blank", isTopFrame: false }, shell)).toBe(true);
    expect(
      allowReaderNavigation(
        { url: "http://127.0.0.1:8088/books/chapter.xhtml", isTopFrame: false },
        shell,
      ),
    ).toBe(true);
    expect(
      allowReaderNavigation(
        { url: "http://127.0.0.1:8088/books/chapter.xhtml", isTopFrame: true },
        shell,
      ),
    ).toBe(false);
  });

  it("allows local file chapters without allowing another top-level page", () => {
    const file = "file:///app/reader/reader.html";
    expect(
      allowReaderNavigation({ url: "file:///app/reader/chapter.xhtml", isTopFrame: false }, file),
    ).toBe(true);
    expect(allowReaderNavigation({ url: "file:///private/other.html" }, file)).toBe(false);
  });

  it("cancels Foliate's external-link default before it can open Wiktionary", () => {
    const html = fs.readFileSync(
      new URL("../../../assets/reader/reader.template.html", import.meta.url),
      "utf8",
    );
    const start = html.indexOf("el.addEventListener('external-link'");
    const end = html.indexOf("\n        });", start) + "\n        });".length;
    const view = new EventTarget();
    vm.runInNewContext(html.slice(start, end), { el: view });
    const event = new Event("external-link", { cancelable: true });
    expect(view.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });
});

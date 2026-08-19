import { describe, expect, it, vi } from "vitest";
import { type Ao3ImportError, importAo3FromUrl, isAo3Url, parseAo3Url } from "./import-ao3";

const workHtml = `
  <html><head><title>Example - Chapter 1 - Author [Archive of Our Own]</title></head>
  <body>
    <li class="download"><a href="/downloads/90770006/Example_Work.epub?updated_at=123">EPUB</a></li>
  </body></html>
`;

const epubBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

describe("AO3 URL import", () => {
  it("recognizes the AO3 host separately from a concrete work URL", () => {
    expect(isAo3Url("https://archiveofourown.org/?ref=website-popularity")).toBe(true);
    expect(parseAo3Url("https://archiveofourown.org/?ref=website-popularity")).toBeNull();
    expect(parseAo3Url("https://archiveofourown.org/works/90770006")).toEqual({
      workId: "90770006",
    });
    expect(parseAo3Url("https://archiveofourown.org/works/90770006/chapters/1")).toEqual({
      workId: "90770006",
    });
    expect(parseAo3Url("https://archiveofourown.org/collections/example/works/90770006")).toEqual({
      workId: "90770006",
    });
  });

  it("downloads the canonical work page and its official EPUB", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://archiveofourown.org/works/90770006?view_adult=true") {
        return new Response(workHtml, { status: 200 });
      }
      if (
        url === "https://archiveofourown.org/downloads/90770006/Example_Work.epub?updated_at=123"
      ) {
        return new Response(epubBytes, {
          status: 200,
          headers: { "content-type": "application/epub+zip" },
        });
      }
      return new Response("missing", { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const result = await importAo3FromUrl("https://archiveofourown.org/works/90770006", {
      fetchImpl,
    });

    expect(result.fileName).toBe("Example_Work.epub");
    expect(result.epubBytes).toEqual(epubBytes);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a site page with an actionable work-link error", async () => {
    await expect(
      importAo3FromUrl("https://archiveofourown.org/?ref=website-popularity", {
        fetchImpl: vi.fn() as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<Ao3ImportError>>({
        code: "ao3-work-link-required",
      }),
    );
  });

  it("does not import an HTML error page as an EPUB", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(workHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response("<html>challenge</html>", { status: 200 }));

    await expect(
      importAo3FromUrl("https://archiveofourown.org/works/90770006", {
        fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<Ao3ImportError>>({ code: "ao3-parse" }));
  });
});

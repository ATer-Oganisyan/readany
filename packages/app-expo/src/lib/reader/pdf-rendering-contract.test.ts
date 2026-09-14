import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PDF reader assets", () => {
  it("keeps the selectable text layer aligned and visually transparent", () => {
    const source = readFileSync(new URL("../../../../foliate-js/pdf.js", import.meta.url), "utf8");

    expect(source).toContain("-webkit-text-size-adjust: none;");
    expect(source).toContain("color: transparent !important;");
    expect(source).toContain('style.setProperty("--scale-factor", scale)');
    expect(source).toContain('<html lang="en" data-readany-pdf>');
    expect(source).toContain("isPDF: true");
    expect(source).toContain("physicalPageCount: numPages");
  });

  it("ships reader assets generated from the current template and PDF adapter", () => {
    const html = readFileSync(new URL("../../../assets/reader/reader.html", import.meta.url));
    const build = JSON.parse(
      readFileSync(new URL("../../../assets/reader/reader-build.json", import.meta.url), "utf8"),
    );
    const pdfBundle = readFileSync(
      new URL("../../../assets/reader/reader-pdf.bin", import.meta.url),
    );

    expect(build.htmlMd5).toBe(createHash("md5").update(html).digest("hex"));
    expect(pdfBundle.includes(Buffer.from("--scale-factor"))).toBe(true);
    expect(pdfBundle.includes(Buffer.from("data-readany-pdf"))).toBe(true);
    expect(pdfBundle.includes(Buffer.from("physicalPageCount"))).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  bookIdentityNeedsLlmRepair,
  normalizeBookIdentityValue,
  resolveBookIdentityDeterministically,
  resolveBookIdentityWithLlmFallback,
} from "./book-identity-resolver";

describe("book identity resolver", () => {
  it("trusts embedded EPUB metadata even when the title equals the file name", async () => {
    const generateWithLlm = vi.fn();
    const result = await resolveBookIdentityWithLlmFallback(
      {
        fileName: "Pride and Prejudice.epub",
        detectedTitle: "Pride and Prejudice",
        detectedAuthor: "Jane Austen",
        provenance: { title: "epub-opf", author: "epub-opf" },
      },
      generateWithLlm,
    );

    expect(result).toMatchObject({
      title: "Pride and Prejudice",
      author: "Jane Austen",
      provenance: { title: "epub-opf", author: "epub-opf" },
      llmStatus: "not-needed",
    });
    expect(generateWithLlm).not.toHaveBeenCalled();
  });

  it("uses LLM only after a filename-only candidate", async () => {
    const generateWithLlm = vi.fn().mockResolvedValue({
      title: "Преступление и наказание",
      author: "Фёдор Достоевский",
    });
    const result = await resolveBookIdentityWithLlmFallback(
      {
        fileName: "book-019.epub",
        detectedTitle: "book-019",
        provenance: { title: "filename", author: "missing" },
        excerpt: "Родион Раскольников вышел из своей каморки.",
      },
      generateWithLlm,
    );

    expect(generateWithLlm).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      title: "Преступление и наказание",
      author: "Фёдор Достоевский",
      provenance: { title: "llm", author: "llm" },
      llmStatus: "used",
    });
  });

  it("keeps a trusted title while filling a missing author through LLM", async () => {
    const result = await resolveBookIdentityWithLlmFallback(
      {
        fileName: "master.epub",
        detectedTitle: "Мастер и Маргарита",
        provenance: { title: "epub-opf", author: "missing" },
        excerpt: "Однажды весною, в час необычайно жаркого заката...",
      },
      async () => ({ title: "The Master and Margarita", author: "Михаил Булгаков" }),
    );

    expect(result.title).toBe("Мастер и Маргарита");
    expect(result.author).toBe("Михаил Булгаков");
    expect(result.provenance).toEqual({ title: "epub-opf", author: "llm" });
  });

  it("falls back to deterministic metadata when LLM fails", async () => {
    const result = await resolveBookIdentityWithLlmFallback(
      {
        fileName: "readable-name.pdf",
        detectedTitle: "readable-name",
        provenance: { title: "filename", author: "missing" },
      },
      async () => {
        throw new Error("offline");
      },
    );

    expect(result).toMatchObject({
      title: "readable-name",
      author: "",
      provenance: { title: "filename", author: "missing" },
      llmStatus: "failed",
    });
  });

  it("normalizes Unicode and whitespace without translating or changing case", () => {
    expect(normalizeBookIdentityValue("  Ма\u0308стер\n\tИ\u200BВОЛАНД  ")).toBe("Мӓстер И ВОЛАНД");
  });

  it("marks a missing author or filename title for repair", () => {
    const result = resolveBookIdentityDeterministically({
      fileName: "Siddhartha.epub",
      detectedTitle: "Siddhartha",
      provenance: { title: "filename", author: "missing" },
    });

    expect(bookIdentityNeedsLlmRepair(result)).toBe(true);
    expect(result.candidates).toEqual([
      {
        field: "title",
        value: "Siddhartha",
        source: "filename",
        confidence: 0.35,
      },
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/narra/media", () => ({
  acknowledgeBookCoverJob: vi.fn(),
  generateBookCoverImage: vi.fn(),
}));
vi.mock("@readany/core/utils", () => ({ generateId: () => "request-1" }));
vi.mock("./cover-job-repository", () => ({
  deleteLocalCoverJob: vi.fn(),
  getLocalCoverJob: vi.fn(),
  getOrCreateLocalCoverJob: vi.fn(async ({ bookId, requestId, prompt }) => ({
    bookId,
    requestId,
    prompt,
    status: "submitting",
    nextPollAt: 0,
    createdAt: 1,
    updatedAt: 1,
  })),
  updateLocalCoverJob: vi.fn(),
}));

import { acknowledgeBookCoverJob, generateBookCoverImage } from "@/lib/narra/media";
import {
  deleteLocalCoverJob,
  getLocalCoverJob,
  getOrCreateLocalCoverJob,
} from "./cover-job-repository";
import coverGenerationConfig from "./cover-generation-config.json";
import {
  acknowledgeGeneratedBookCover,
  coverPrompt,
  generateBookCover,
} from "./generate-book-cover";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("coverPrompt", () => {
  it("builds the approved GPT Image 2 cover prompt with book context", () => {
    const prompt = coverPrompt({
      title: "Анна Каренина",
      author: "Лев Толстой",
      description: "Роман о семье, любви и давлении общества.",
      subjects: ["literary fiction"],
      accentColor1: "deep crimson red",
    });

    expect(prompt).toContain("Create the complete front-cover artwork");
    expect(prompt).toContain("late modernist editorial design");
    expect(prompt).toContain("two-fifths of the total canvas height");
    expect(prompt).toContain("38–42%");
    expect(prompt).toContain("must never exceed about 45%");
    expect(prompt).toContain("ABSOLUTELY NO TEXT");
    expect(prompt).toContain("“Анна Каренина”");
    expect(prompt).toContain("Лев Толстой");
    expect(prompt).toContain("Роман о семье, любви и давлении общества.");
    expect(prompt).toContain("BOOK GENRE:\nliterary fiction");
    expect(prompt).toContain("psychological and social tension");
    expect(prompt).toContain("SHARED BACKGROUND SYSTEM — IDENTICAL ACROSS ALL GENRES");
    expect(prompt).toContain("deep crimson red");
    expect(prompt).not.toContain("{{BOOK_TITLE}}");
    expect(prompt).not.toContain("{{BACKGROUND_COLOR}}");
    expect(prompt).not.toContain("{{BOOK_GENRE}}");
    expect(prompt).not.toContain("{{GENRE_ART_DIRECTION}}");
  });

  it("keeps the catalog-scripts model config aligned with the gateway default", () => {
    expect(coverGenerationConfig.openRouterModel).toBe("openai/gpt-image-2");
  });

  it("fills missing metadata and selects a stable dominant background color", () => {
    const first = coverPrompt({ title: "Неизвестная книга" });
    const second = coverPrompt({ title: "Неизвестная книга" });

    expect(first).toBe(second);
    expect(first).toContain("Unknown author");
    expect(first).toContain("Infer the central idea, mood, symbols and historical context");
    expect(first).toContain("BOOK GENRE:\nclassics / general literature");
    expect(first).toContain("late-modernist paper collage");
    expect(first).not.toMatch(/\{\{[A-Z_]+\}\}/u);
    expect(coverGenerationConfig.backgroundColors.some((color) => first.includes(color))).toBe(
      true,
    );
  });

  it("caps long book descriptions while preserving the complete art direction", () => {
    const prompt = coverPrompt({
      description: "Очень длинное описание содержания книги. ".repeat(30),
      title: "Книга",
    });

    expect(prompt).toContain("CRITICAL OUTPUT RULE");
    expect(prompt.length).toBeLessThan(8_000);
  });

  it("adds a genre-specific direction inferred from content when metadata is absent", () => {
    const prompt = coverPrompt({
      title: "Книга",
      description: "Исторический роман о семье на фоне революции.",
    });

    expect(prompt).toContain("BOOK GENRE:\nhistorical fiction");
    expect(prompt).toContain("era-specific engraved figure");
  });

  it("keeps the background system fixed while allowing a 1990s anime manga illustration", () => {
    const prompt = coverPrompt({ title: "Книга", subjects: ["manga"] });

    expect(prompt).toContain("BOOK GENRE:\nmanga or anime graphic fiction");
    expect(prompt).toContain("1990s cel anime");
    expect(prompt).toContain("Genre variation belongs only inside the compact focal illustration");
  });
});

describe("generateBookCover", () => {
  it("sends only the assembled prompt to the gateway and decodes the returned image", async () => {
    vi.mocked(generateBookCoverImage).mockResolvedValueOnce({
      base64: btoa("jpeg-bytes"),
      mimeType: "image/jpeg",
      jobId: "job-1",
    });

    const generated = await generateBookCover({
      bookId: "book-1",
      title: "Анна Каренина",
      author: "Лев Толстой",
      description: "Роман о семье, любви и давлении общества.",
    });

    expect(generateBookCoverImage).toHaveBeenCalledTimes(1);
    const [prompt, options] = vi.mocked(generateBookCoverImage).mock.calls[0] ?? [];
    expect(prompt).toContain("Create the complete front-cover artwork");
    expect(prompt).toContain("“Анна Каренина”");
    expect(options).toMatchObject({ requestId: "request-1" });
    expect(generated.mimeType).toBe("image/jpeg");
    expect(generated.jobId).toBe("job-1");
    expect(new TextDecoder().decode(generated.bytes)).toBe("jpeg-bytes");
  });

  it("propagates gateway failures to the caller for retry bookkeeping", async () => {
    vi.mocked(generateBookCoverImage).mockRejectedValueOnce(
      new Error("Cover generation failed (429)"),
    );

    await expect(generateBookCover({ bookId: "book-1", title: "Книга" })).rejects.toThrow(
      "Cover generation failed (429)",
    );
  });

  it("resumes the persisted server job after a JS reload", async () => {
    vi.mocked(getOrCreateLocalCoverJob).mockResolvedValueOnce({
      bookId: "book-1",
      requestId: "request-1",
      jobId: "job-existing",
      prompt: "persisted prompt",
      status: "running",
      nextPollAt: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    vi.mocked(generateBookCoverImage).mockResolvedValueOnce({
      base64: btoa("jpeg-bytes"),
      mimeType: "image/jpeg",
      jobId: "job-existing",
    });

    await generateBookCover({ bookId: "book-1", title: "Changed title" });

    expect(generateBookCoverImage).toHaveBeenCalledWith(
      "persisted prompt",
      expect.objectContaining({ requestId: "request-1", jobId: "job-existing" }),
    );
  });

  it("recreates only an expired server job", async () => {
    vi.mocked(getOrCreateLocalCoverJob)
      .mockResolvedValueOnce({
        bookId: "book-1",
        requestId: "old-request",
        jobId: "expired-job",
        prompt: "old prompt",
        status: "running",
        nextPollAt: 0,
        createdAt: 1,
        updatedAt: 1,
      })
      .mockResolvedValueOnce({
        bookId: "book-1",
        requestId: "request-1",
        prompt: "new prompt",
        status: "submitting",
        nextPollAt: 0,
        createdAt: 2,
        updatedAt: 2,
      });
    vi.mocked(generateBookCoverImage)
      .mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }))
      .mockResolvedValueOnce({
        base64: btoa("jpeg-bytes"),
        mimeType: "image/jpeg",
        jobId: "new-job",
      });

    await expect(
      generateBookCover({ bookId: "book-1", title: "Книга" }),
    ).resolves.toMatchObject({ jobId: "new-job" });
    expect(deleteLocalCoverJob).toHaveBeenCalledWith("book-1");
    expect(generateBookCoverImage).toHaveBeenCalledTimes(2);
  });

  it("acks and deletes a durable result after local persistence", async () => {
    vi.mocked(getLocalCoverJob).mockResolvedValueOnce({
      bookId: "book-1",
      requestId: "request-1",
      jobId: "job-1",
      prompt: "prompt",
      status: "completed",
      nextPollAt: 0,
      createdAt: 1,
      updatedAt: 1,
    });

    await acknowledgeGeneratedBookCover("book-1");

    expect(acknowledgeBookCoverJob).toHaveBeenCalledWith("job-1");
    expect(deleteLocalCoverJob).toHaveBeenCalledWith("book-1");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/narra/media", () => ({
  generateBookCoverImage: vi.fn(),
}));
vi.mock("@readany/core/utils", () => ({ generateId: () => "request-1" }));
vi.mock("./cover-job-repository", () => ({
  deleteLocalCoverJob: vi.fn(),
  getLocalCoverJob: vi.fn(),
  getOrCreateLocalCoverJob: vi.fn(async ({ bookId, requestId, request }) => ({
    bookId,
    requestId,
    request,
    status: "submitting",
    nextPollAt: 0,
    createdAt: 1,
    updatedAt: 1,
  })),
  updateLocalCoverJob: vi.fn(),
}));

import { generateBookCoverImage } from "@/lib/narra/media";
import { deleteLocalCoverJob, getOrCreateLocalCoverJob } from "./cover-job-repository";
import { acknowledgeGeneratedBookCover, generateBookCover } from "./generate-book-cover";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateBookCover", () => {
  it("sends structured book context to the gateway and decodes the returned image", async () => {
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
    const [request, options] = vi.mocked(generateBookCoverImage).mock.calls[0] ?? [];
    expect(request).toEqual({
      book: {
        title: "Анна Каренина",
        author: "Лев Толстой",
        description: "Роман о семье, любви и давлении общества.",
        excerpt: undefined,
        subjects: undefined,
      },
    });
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

  it("reuses the persisted local prompt after a JS reload", async () => {
    vi.mocked(getOrCreateLocalCoverJob).mockResolvedValueOnce({
      bookId: "book-1",
      requestId: "request-1",
      jobId: "job-existing",
      request: { book: { title: "Original title" } },
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
      { book: { title: "Original title" } },
      {
        requestId: "request-1",
      },
    );
  });

  it("deletes the local intent after local persistence", async () => {
    await acknowledgeGeneratedBookCover("book-1");

    expect(deleteLocalCoverJob).toHaveBeenCalledWith("book-1");
  });
});

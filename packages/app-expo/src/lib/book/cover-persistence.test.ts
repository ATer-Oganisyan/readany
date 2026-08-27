import { describe, expect, it, vi } from "vitest";
import { validateCoverImage } from "./cover-image";
import { persistCoverFile, verifyCoverPersistence } from "./cover-persistence";

const bytes = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVZkAAAAASUVORK5CYII=",
  ),
  (char) => char.charCodeAt(0),
);
function storage() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    write: vi.fn(async (path: string, data: Uint8Array) => {
      files.set(path, data.slice());
    }),
    move: vi.fn(async (from: string, to: string) => {
      const data = files.get(from);
      if (!data) throw new Error("missing temp");
      files.set(to, data);
      files.delete(from);
    }),
    read: vi.fn(async (path: string) => {
      const data = files.get(path);
      if (!data) throw new Error("missing file");
      return data;
    }),
  };
}
describe("cover persistence before ACK", () => {
  it("writes to a temporary file, atomically moves it, then checks the actual bytes", async () => {
    const io = storage();
    await persistCoverFile({
      ...io,
      bytes,
      mimeType: "image/png",
      temporaryPath: "new.tmp",
      destinationPath: "new.png",
    });
    expect(io.files.has("new.tmp")).toBe(false);
    expect(io.files.get("new.png")).toEqual(bytes);
    expect(io.write.mock.invocationCallOrder[0]).toBeLessThan(io.move.mock.invocationCallOrder[0]);
    expect(io.move.mock.invocationCallOrder[0]).toBeLessThan(io.read.mock.invocationCallOrder[0]);
    await verifyCoverPersistence({
      expectedUrl: "new.png",
      readSavedUrl: async () => "new.png",
      readImage: () => io.read("new.png"),
    });
  });
  it.each(["write", "move", "read"] as const)(
    "propagates %s failures so the server result is retained",
    async (stage) => {
      const io = storage();
      io[stage].mockRejectedValueOnce(new Error(stage));
      await expect(
        persistCoverFile({
          ...io,
          bytes,
          mimeType: "image/png",
          temporaryPath: "new.tmp",
          destinationPath: "new.png",
        }),
      ).rejects.toThrow(stage);
    },
  );
  it("rejects truncated data after the rename", async () => {
    const io = storage();
    io.read.mockResolvedValueOnce(bytes.subarray(0, 8));
    await expect(
      persistCoverFile({
        ...io,
        bytes,
        mimeType: "image/png",
        temporaryPath: "new.tmp",
        destinationPath: "new.png",
      }),
    ).rejects.toThrow("not persisted");
  });
  it("does not trust an in-memory cover URL absent from the DB", async () => {
    const readImage = vi.fn(async () => bytes);
    await expect(
      verifyCoverPersistence({
        expectedUrl: "new.png",
        readSavedUrl: async () => undefined,
        readImage,
      }),
    ).rejects.toThrow("database");
    expect(readImage).not.toHaveBeenCalled();
  });
  it("does not trust a DB URL whose file was lost", async () => {
    await expect(
      verifyCoverPersistence({
        expectedUrl: "new.png",
        readSavedUrl: async () => "new.png",
        readImage: async () => {
          throw new Error("missing file");
        },
      }),
    ).rejects.toThrow("missing file");
  });
  it("rejects invalid base64 results, wrong MIME and empty images before saving", () => {
    expect(() => validateCoverImage(bytes, "image/png")).not.toThrow();
    expect(() => validateCoverImage(bytes, "image/jpeg")).toThrow();
    expect(() => validateCoverImage(new Uint8Array(), "image/png")).toThrow();
    expect(() => validateCoverImage(bytes, "image/svg+xml")).toThrow();
  });
});

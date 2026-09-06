import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hash } = vi.hoisted(() => ({ hash: vi.fn() }));

vi.mock("@dr.pogodin/react-native-fs", () => ({ hash }));

import { sha256BackendFile, trySha256BackendFile } from "./backend-file-hash";

describe("backend file hashing", () => {
  beforeEach(() => {
    hash.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("keeps strict backend hashing", async () => {
    hash.mockRejectedValueOnce(new Error("provider denied access"));

    await expect(sha256BackendFile("file:///picked/book.fb2")).rejects.toThrow(
      "provider denied access",
    );
  });

  it("does not fail a local import when iOS cannot hash the picked URL", async () => {
    hash.mockRejectedValueOnce(new Error("provider denied access"));

    await expect(trySha256BackendFile("file:///picked/book.fb2")).resolves.toBeUndefined();
  });

  it("returns the hash when the picked URL is readable", async () => {
    hash.mockResolvedValueOnce("sha256");

    await expect(trySha256BackendFile("file:///picked/book.fb2")).resolves.toBe("sha256");
  });

  it.each(["02-мастерская 100_.EPUB", "literal%20.epub", "literal%.epub"])(
    "hashes the real picked file %s rather than its percent-encoded URI spelling",
    async (name) => {
      const directory = mkdtempSync(join(tmpdir(), "narra-hash-own-"));
      try {
        const file = join(directory, name);
        const bytes = Buffer.from("own synthetic book bytes");
        writeFileSync(file, bytes);
        // Match installed RNFS normalizeFilePath + native FileInputStream:
        // remove the scheme only, then open a literal filesystem path.
        hash.mockImplementation(async (path: string, algorithm: string) =>
          createHash(algorithm)
            .update(readFileSync(path.replace(/^file:\/\//, "")))
            .digest("hex"),
        );
        const uri = pathToFileURL(file).href;
        if (name === "literal%20.epub") expect(uri).toContain("literal%2520.epub");
        const digest = createHash("sha256").update(bytes).digest("hex");
        await expect(trySha256BackendFile(uri)).resolves.toBe(digest);
        // A raw filesystem path is already decoded. Its percent signs are literal.
        await expect(sha256BackendFile(file)).resolves.toBe(digest);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("preserves opaque content-provider URIs", async () => {
    const uri =
      "content://own.documents/tree/primary%3ABooks/document/primary%3ABooks%2F100%2520.epub";
    hash.mockResolvedValue("provider-hash");
    await expect(sha256BackendFile(uri)).resolves.toBe("provider-hash");
    expect(hash).toHaveBeenCalledExactlyOnceWith(uri, "sha256");
  });

  it("does not guess a different path when file URI encoding is malformed", async () => {
    await expect(sha256BackendFile("file:///own/bad%GG.epub")).rejects.toThrow(URIError);
    await expect(trySha256BackendFile("file:///own/bad%GG.epub")).resolves.toBeUndefined();
    expect(hash).not.toHaveBeenCalled();
  });
});

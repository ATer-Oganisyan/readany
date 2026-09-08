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
});

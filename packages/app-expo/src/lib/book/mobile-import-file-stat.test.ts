import { describe, expect, it, vi } from "vitest";
import { getMobileFileStat, resolveImportFileSize } from "./mobile-import-file-stat";

describe("mobile import file stat", () => {
  it("prefers the measured file size over the picker hint", async () => {
    const readInfo = vi.fn(async () => ({
      exists: true,
      isDirectory: false,
      size: 2048,
      modificationTime: 17,
    }));

    await expect(getMobileFileStat("file:///picked/book.pdf", 4096, readInfo)).resolves.toEqual({
      size: 2048,
      md5: undefined,
      modificationTime: 17_000,
    });
    expect(readInfo).toHaveBeenCalledWith("file:///picked/book.pdf");
  });

  it.each([
    { exists: true, isDirectory: false, size: 0 },
    { exists: true, isDirectory: false },
    { exists: false, isDirectory: false },
  ])("uses the picker size when the legacy stat cannot measure the file", async (info) => {
    await expect(
      getMobileFileStat("file:///picked/book.pdf", 4096, async () => info),
    ).resolves.toMatchObject({ size: 4096 });
  });

  it("uses the picker size when the legacy stat throws", async () => {
    await expect(
      getMobileFileStat("file:///picked/book.pdf", 4096, async () => {
        throw new Error("provider denied access");
      }),
    ).resolves.toMatchObject({ size: 4096 });
  });

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not accept an invalid picker size: %s",
    async (pickerSize) => {
      await expect(
        getMobileFileStat("file:///picked/book.pdf", pickerSize, async () => ({
          exists: true,
          isDirectory: false,
          size: 0,
        })),
      ).resolves.toMatchObject({ size: 0 });
    },
  );

  it("keeps a stat error strict when the picker has no usable size", async () => {
    await expect(
      getMobileFileStat("file:///picked/book.pdf", undefined, async () => {
        throw new Error("provider denied access");
      }),
    ).rejects.toThrow("provider denied access");
  });

  it("resolves only finite positive sizes", () => {
    expect(resolveImportFileSize(1024, 2048)).toBe(1024);
    expect(resolveImportFileSize(0, 2048)).toBe(2048);
    expect(resolveImportFileSize(Number.NaN, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

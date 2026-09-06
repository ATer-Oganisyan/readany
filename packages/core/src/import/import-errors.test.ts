import { describe, expect, it } from "vitest";
import { BookImportError, getBookImportFailureCode } from "./import-errors";

describe("BookImportError diagnostics and ES2020-compatible cause", () => {
  it("retains the original cause without making it enumerable UI data", () => {
    const cause = new Error("private storage path");
    const error = new BookImportError("STORAGE_FAILED", "Could not save book", { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BookImportError");
    expect(error.message).toBe("Could not save book");
    expect(getBookImportFailureCode(error)).toBe("STORAGE_FAILED");
    expect(Object.getOwnPropertyDescriptor(error, "cause")).toEqual({
      value: cause,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  });

  it("does not create a cause property when the caller provides none", () => {
    const error = new BookImportError("CORRUPT_SOURCE", "Invalid archive");
    expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
  });

  it("preserves explicitly supplied undefined cause", () => {
    const error = new BookImportError("UNKNOWN", "Failed", { cause: undefined });
    expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(error, "cause")?.value).toBeUndefined();
  });

  it("does not trust a code property on an unrelated error", () => {
    expect(getBookImportFailureCode({ code: "CORRUPT_SOURCE" })).toBeUndefined();
  });
});

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const filename = fileURLToPath(
  new URL("../../../../core/src/import/import-errors.ts", import.meta.url),
);
const configFile = fileURLToPath(new URL("../../../babel.config.js", import.meta.url));

describe.each(["ios", "android"])(
  "import errors in the actual Expo Babel pipeline (%s)",
  (platform) => {
    it("transforms and executes with the project's Metro/Expo configuration", () => {
      const result = transformSync(readFileSync(filename, "utf8"), {
        filename,
        configFile,
        babelrc: false,
        caller: {
          name: "metro",
          bundler: "metro",
          platform,
          engine: "hermes",
          isDev: true,
          isServer: false,
          supportsStaticESM: false,
          supportsExportNamespaceFrom: true,
        },
      });
      expect(result?.code).toBeTruthy();
      const module = {
        exports: {} as {
          BookImportError: new (
            code: string,
            message: string,
            options?: { cause?: unknown },
          ) => Error;
          getBookImportFailureCode: (error: unknown) => string | undefined;
        },
      };
      runInNewContext(result.code, { module, exports: module.exports, require, Error });
      const { BookImportError, getBookImportFailureCode } = module.exports;
      const cause = new Error("original storage failure");
      const error = new BookImportError("STORAGE_FAILED", "Could not save book", { cause });
      expect(error).toBeInstanceOf(Error);
      expect(getBookImportFailureCode(error)).toBe("STORAGE_FAILED");
      expect(Object.getOwnPropertyDescriptor(error, "cause")).toEqual({
        value: cause,
        enumerable: false,
        writable: true,
        configurable: true,
      });
      expect(
        Object.prototype.hasOwnProperty.call(new BookImportError("UNKNOWN", "Failed"), "cause"),
      ).toBe(false);
    });
  },
);

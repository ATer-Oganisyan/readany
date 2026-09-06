import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const configPath = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
const coreDirectory = path.dirname(configPath);
const raw = ts.readConfigFile(configPath, ts.sys.readFile);
if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, "\n"));
const config = ts.parseJsonConfigFileContent(
  raw.config,
  ts.sys,
  coreDirectory,
  undefined,
  configPath,
);
const importer = fileURLToPath(import.meta.url);

describe("core TypeScript configuration without deprecated baseUrl", () => {
  it("has no compiler option diagnostics without a deprecation-suppression flag", () => {
    expect(config.errors).toEqual([]);
    expect(config.options.ignoreDeprecations).toBeUndefined();
    const program = ts.createProgram([], config.options);
    expect(program.getOptionsDiagnostics()).toEqual([]);
  });

  it.each([
    ["@readany/core", "src/index.ts"],
    ["@readany/core/utils/store-only-zip", "src/utils/store-only-zip.ts"],
  ])("resolves %s relative to the actual config location", (specifier, expected) => {
    const result = ts.resolveModuleName(specifier, importer, config.options, ts.sys).resolvedModule;
    expect(result?.resolvedFileName).toBe(path.join(coreDirectory, expected));
  });

  it("still resolves ordinary external package imports", () => {
    const result = ts.resolveModuleName("zustand", importer, config.options, ts.sys).resolvedModule;
    expect(result?.isExternalLibraryImport).toBe(true);
    expect(result?.resolvedFileName).toContain("node_modules/");
  });
});

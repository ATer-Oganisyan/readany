import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  share: vi.fn(async () => {}),
  available: vi.fn(async () => true),
}));
vi.mock("expo-constants", () => ({
  default: { nativeAppVersion: "1.3.5", nativeBuildVersion: "67" },
}));
vi.mock("expo-sharing", () => ({ shareAsync: mocks.share, isAvailableAsync: mocks.available }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios", Version: "27.0" },
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
}));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  cacheDirectory: "file:///cache/",
  getInfoAsync: async (path: string) => ({
    exists: mocks.files.has(path),
    size: mocks.files.get(path)?.length ?? 0,
  }),
  readAsStringAsync: async (path: string) => mocks.files.get(path) ?? "[]",
  writeAsStringAsync: async (path: string, value: string) => {
    mocks.files.set(path, value);
  },
  makeDirectoryAsync: async () => {},
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("__DEV__", false);
  mocks.files.clear();
  mocks.share.mockReset().mockResolvedValue();
  mocks.available.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.unstubAllGlobals());

describe("system log sharing", () => {
  it("shares only a sanitized JSON report with actual native build metadata", async () => {
    const { recordDiagnostic, shareDiagnosticLogs } = await import("./diagnostics");
    recordDiagnostic("reader_error", {
      reason: "transport",
      message: "sk-secret",
      bookId: "private",
    });
    await shareDiagnosticLogs("Share logs");
    const [uri, options] = mocks.share.mock.calls[0] as unknown as [string, Record<string, string>];
    expect(uri).toBe("file:///cache/narra-diagnostics-export/Narra-logs.json");
    expect(options.UTI).toBe("public.json");
    const content = mocks.files.get(uri);
    if (!content) throw new Error("Missing exported log file");
    const report = JSON.parse(content);
    expect(report.build).toBe("67");
    expect(report.events[0].data).toEqual({ reason: "transport" });
    expect(JSON.stringify(report)).not.toContain("sk-secret");
    expect(JSON.stringify(report)).not.toContain("private");
  });

  it("deduplicates rapid taps and permits sharing after a dismissed sheet", async () => {
    const { shareDiagnosticLogs } = await import("./diagnostics");
    const first = shareDiagnosticLogs("Logs");
    expect(shareDiagnosticLogs("Logs")).toBe(first);
    await first;
    await shareDiagnosticLogs("Logs");
    expect(mocks.share).toHaveBeenCalledTimes(2);
  });

  it("does not open a broken share sheet and permits retry", async () => {
    const { shareDiagnosticLogs } = await import("./diagnostics");
    mocks.available.mockResolvedValueOnce(false);
    await expect(shareDiagnosticLogs("Logs")).rejects.toThrow("unavailable");
    expect(mocks.share).not.toHaveBeenCalled();
    await expect(shareDiagnosticLogs("Logs")).resolves.toBeUndefined();
  });
});

import type { Book } from "@readany/core/types";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  updateBook: vi.fn(),
  downloadBookFile: vi.fn(),
  createSyncBackend: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({ toast: { error: runtime.error } }));
vi.mock("@readany/core/services", () => ({
  getPlatformService: () => ({ kvGetItem: async () => "test-password" }),
}));
vi.mock("@readany/core/stores/sync-store", () => ({
  useSyncStore: { getState: () => ({ config: { type: "webdav" } }) },
}));
vi.mock("@readany/core/sync", () => ({ downloadBookFile: runtime.downloadBookFile }));
vi.mock("@readany/core/db/database", () => ({ updateBook: runtime.updateBook }));
vi.mock("@readany/core/sync/sync-backend-factory", () => ({
  createSyncBackend: runtime.createSyncBackend,
}));
vi.mock("@/stores/vector-model-store", () => ({
  useVectorModelStore: { getState: () => ({ autoVectorizeOnImport: false }) },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

import { useBookDownload } from "@/screens/library/useBookDownload";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
let current: ReturnType<typeof useBookDownload>;
const loadBooks = vi.fn();
const onSuccess = vi.fn();
const book = {
  id: "remote-book",
  filePath: "books/remote-book.epub",
  syncStatus: "remote",
  meta: { title: "Cloud book" },
} as Book;
function Harness() {
  current = useBookDownload({ loadBooks, onSuccess });
  return null;
}

describe("cloud download action recovery", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    runtime.updateBook.mockResolvedValue(undefined);
    runtime.createSyncBackend.mockReturnValue({});
    runtime.downloadBookFile.mockResolvedValue("ok");
    loadBooks.mockResolvedValue(undefined);
    await act(async () => {
      tree = create(<Harness />);
    });
  });
  afterEach(async () => {
    await act(async () => tree.unmount());
  });

  it("restores remote status if refresh fails before the transfer starts", async () => {
    loadBooks.mockRejectedValueOnce(new Error("SQLite busy during refresh"));
    await act(async () => {
      expect(await current.downloadBook(book)).toBe(false);
    });
    expect(runtime.downloadBookFile).not.toHaveBeenCalled();
    expect(runtime.updateBook).toHaveBeenLastCalledWith(book.id, { syncStatus: "remote" });
    expect(current.downloadingBookId).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("restores remote status if backend setup throws after marking downloading", async () => {
    runtime.createSyncBackend.mockImplementationOnce(() => {
      throw new Error("invalid sync configuration");
    });
    await act(async () => {
      expect(await current.downloadBook(book)).toBe(false);
    });
    expect(runtime.updateBook).toHaveBeenLastCalledWith(book.id, { syncStatus: "remote" });
  });

  it("does not revert a completed local file when the final UI refresh fails", async () => {
    loadBooks.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("refresh failed"));
    await act(async () => {
      await current.downloadBook(book);
    });
    expect(runtime.downloadBookFile).toHaveBeenCalledOnce();
    expect(runtime.updateBook).not.toHaveBeenCalledWith(book.id, { syncStatus: "remote" });
  });

  it("does not start a second download from a double tap and releases the lock afterward", async () => {
    let finish!: (outcome: string) => void;
    runtime.downloadBookFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let first!: Promise<boolean>;
    await act(async () => {
      first = current.downloadBook(book);
      expect(await current.downloadBook(book)).toBe(false);
    });
    expect(runtime.downloadBookFile).toHaveBeenCalledOnce();
    await act(async () => {
      finish("ok");
      expect(await first).toBe(true);
    });
    await act(async () => {
      expect(await current.downloadBook(book)).toBe(true);
    });
    expect(runtime.downloadBookFile).toHaveBeenCalledTimes(2);
  });
});

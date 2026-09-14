import { beforeEach, expect, it, vi } from "vitest";
import { openBookDetails } from "./open-book-details";

const prepare = vi.hoisted(() => vi.fn());
vi.mock("@/components/navigation/SystemSheetZoomSource", () => ({ prepareSheetZoom: prepare }));
const navigate = vi.fn();
const isFocused = vi.fn(() => true);
const navigation = { navigate, isFocused } as unknown as Parameters<typeof openBookDetails>[0];
beforeEach(() => {
  vi.clearAllMocks();
  prepare.mockResolvedValue(undefined);
  isFocused.mockReturnValue(true);
});
it("waits for native preparation and ignores a second tap while it is pending", async () => {
  let finish!: () => void;
  prepare.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const opening = openBookDetails(navigation, { bookId: "a", coverUri: "file:///a.jpg" }, "card:a");
  expect(navigate).not.toHaveBeenCalled();
  expect(await openBookDetails(navigation, { bookId: "b" }, "card:b")).toBe(false);
  finish();
  expect(await opening).toBe(true);
  expect(navigate).toHaveBeenCalledExactlyOnceWith("BookDetails", {
    bookId: "a",
    coverUri: "file:///a.jpg",
    sourceId: "card:a",
  });
});
it("clears pending native state if focus is lost during preparation", async () => {
  prepare.mockImplementationOnce(async () => {
    isFocused.mockReturnValue(false);
  });
  expect(await openBookDetails(navigation, { bookId: "a" }, "card:a")).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  expect(prepare).toHaveBeenLastCalledWith("");
});
it("opens normally when the native source cannot be prepared", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  prepare.mockRejectedValueOnce(new Error("source unavailable"));
  expect(await openBookDetails(navigation, { bookId: "a" }, "card:a")).toBe(true);
  expect(navigate).toHaveBeenCalledExactlyOnceWith("BookDetails", { bookId: "a" });
  warning.mockRestore();
});
it("keeps context-menu opening available without a zoom source", async () => {
  expect(await openBookDetails(navigation, { bookId: "a" })).toBe(true);
  expect(prepare).not.toHaveBeenCalled();
});

import { describe, expect, it } from "vitest";
import { CatalogImportCoordinator } from "./catalog-import-coordinator";

describe("catalog import coordinator", () => {
  it("cancels a hung download when another catalog book is selected", () => {
    const coordinator = new CatalogImportCoordinator();
    const first = coordinator.begin("book-1");
    expect(first.status).toBe("started");
    if (first.status !== "started") throw new Error("unexpected state");

    const second = coordinator.begin("book-2");

    expect(first.operation.controller.signal.aborted).toBe(true);
    expect(second.status).toBe("started");
    if (second.status !== "started") throw new Error("unexpected state");
    expect(coordinator.isCurrent(second.operation)).toBe(true);
    expect(coordinator.complete(first.operation)).toBe(false);
    expect(coordinator.isCurrent(second.operation)).toBe(true);
  });

  it("reports repeated taps and does not run two local imports concurrently", () => {
    const coordinator = new CatalogImportCoordinator();
    const started = coordinator.begin("book-1");
    if (started.status !== "started") throw new Error("unexpected state");

    expect(coordinator.begin("book-1").status).toBe("already-active");
    expect(coordinator.markImporting(started.operation)).toBe(true);
    expect(coordinator.begin("book-2").status).toBe("busy-importing");
    expect(started.operation.controller.signal.aborted).toBe(false);
  });
});

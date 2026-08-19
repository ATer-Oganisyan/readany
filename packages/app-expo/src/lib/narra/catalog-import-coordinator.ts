export interface CatalogImportOperation {
  catalogKey: string;
  controller: AbortController;
  phase: "downloading" | "importing";
}

export type BeginCatalogImportResult =
  | { status: "started"; operation: CatalogImportOperation }
  | { status: "already-active"; operation: CatalogImportOperation }
  | { status: "busy-importing"; operation: CatalogImportOperation };

/** Keeps catalog imports serial while allowing a new tap to replace a hung download. */
export class CatalogImportCoordinator {
  private active: CatalogImportOperation | null = null;

  get phase(): CatalogImportOperation["phase"] | null {
    return this.active?.phase ?? null;
  }

  begin(catalogKey: string): BeginCatalogImportResult {
    if (this.active?.catalogKey === catalogKey) {
      return { status: "already-active", operation: this.active };
    }
    if (this.active?.phase === "importing") {
      return { status: "busy-importing", operation: this.active };
    }

    this.active?.controller.abort();
    const operation: CatalogImportOperation = {
      catalogKey,
      controller: new AbortController(),
      phase: "downloading",
    };
    this.active = operation;
    return { status: "started", operation };
  }

  isCurrent(operation: CatalogImportOperation): boolean {
    return this.active === operation;
  }

  markImporting(operation: CatalogImportOperation): boolean {
    if (!this.isCurrent(operation)) return false;
    operation.phase = "importing";
    return true;
  }

  cancelDownload(operation = this.active): boolean {
    if (!operation || !this.isCurrent(operation) || operation.phase !== "downloading") return false;
    operation.controller.abort();
    return true;
  }

  complete(operation: CatalogImportOperation): boolean {
    if (!this.isCurrent(operation)) return false;
    this.active = null;
    return true;
  }

  dispose(): void {
    this.active?.controller.abort();
    this.active = null;
  }
}

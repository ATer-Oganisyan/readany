export type BookImportSource = "backend-catalog" | "local-import";

export interface BookBackgroundWorkPlan {
  owner: "backend" | "local-client";
  runLocalCharacterAnalysis: boolean;
  runLocalCoverGeneration: boolean;
  useServerCharacterManifest: boolean;
  useServerCover: boolean;
}

const BACKEND_CATALOG_PLAN: Readonly<BookBackgroundWorkPlan> = Object.freeze({
  owner: "backend",
  runLocalCharacterAnalysis: false,
  runLocalCoverGeneration: false,
  useServerCharacterManifest: true,
  useServerCover: true,
});

const LOCAL_IMPORT_PLAN: Readonly<BookBackgroundWorkPlan> = Object.freeze({
  owner: "local-client",
  runLocalCharacterAnalysis: true,
  runLocalCoverGeneration: true,
  useServerCharacterManifest: false,
  useServerCover: false,
});

export function planBookBackgroundWork(source: BookImportSource): BookBackgroundWorkPlan {
  return source === "backend-catalog" ? { ...BACKEND_CATALOG_PLAN } : { ...LOCAL_IMPORT_PLAN };
}

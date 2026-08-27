import { validateCoverImage } from "./cover-image";

/** The destination must be unique: never unlink a user's existing cover. */
export async function persistCoverFile(input: {
  bytes: Uint8Array;
  mimeType: string;
  temporaryPath: string;
  destinationPath: string;
  write: (path: string, bytes: Uint8Array) => Promise<void>;
  move: (from: string, to: string) => Promise<void>;
  read: (path: string) => Promise<Uint8Array>;
}): Promise<void> {
  validateCoverImage(input.bytes, input.mimeType);
  await input.write(input.temporaryPath, input.bytes);
  await input.move(input.temporaryPath, input.destinationPath);
  const persisted = await input.read(input.destinationPath);
  if (
    persisted.length !== input.bytes.length ||
    persisted.some((byte, index) => byte !== input.bytes[index])
  ) {
    throw new Error("Cover file was not persisted correctly");
  }
}

export async function verifyCoverPersistence(input: {
  expectedUrl: string;
  readSavedUrl: () => Promise<string | undefined>;
  readImage: () => Promise<Uint8Array>;
}): Promise<void> {
  if ((await input.readSavedUrl()) !== input.expectedUrl) {
    throw new Error("Cover URL was not persisted in the library database");
  }
  const bytes = await input.readImage();
  const ext = input.expectedUrl.split(".").pop()?.toLowerCase();
  validateCoverImage(
    bytes,
    ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : "image/jpeg",
  );
}

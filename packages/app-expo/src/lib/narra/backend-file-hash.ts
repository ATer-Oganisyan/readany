import { hash } from "@dr.pogodin/react-native-fs";

export async function sha256BackendFile(path: string): Promise<string> {
  return hash(path, "sha256");
}

/**
 * Hashing a Document Picker URL is only an import deduplication optimisation.
 * Some iOS file providers do not expose the picked file to react-native-fs,
 * even when expo-file-system can copy it. Do not turn that limitation into a
 * failed book import; backend enrichment hashes the stable copied file later.
 */
export async function trySha256BackendFile(path: string): Promise<string | undefined> {
  try {
    return await sha256BackendFile(path);
  } catch (error) {
    console.warn(
      "[BookImport] Could not hash picked file; continuing without deduplication:",
      error,
    );
    return undefined;
  }
}

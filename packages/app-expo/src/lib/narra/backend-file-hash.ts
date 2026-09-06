import { hash } from "@dr.pogodin/react-native-fs";

export async function sha256BackendFile(path: string): Promise<string> {
  // Expo file URIs encode Unicode, spaces and literal percent signs. RNFS only
  // strips file:// before opening a native filesystem path; it does not decode.
  // Decode local URI paths exactly once (%2520 -> literal %20). Raw paths and
  // opaque content:// document identifiers must retain their original spelling.
  const nativePath = path.startsWith("file:///") ? decodeURIComponent(path.slice(7)) : path;
  return hash(nativePath, "sha256");
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

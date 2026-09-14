export interface MobileImportFileStat {
  size: number;
  md5?: string;
  modificationTime?: number;
}

interface LegacyFileInfo {
  exists: boolean;
  isDirectory: boolean;
  size?: number;
  modificationTime?: number;
}

type ReadLegacyFileInfo = (path: string) => Promise<LegacyFileInfo>;

function positiveFileSize(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function resolveImportFileSize(measuredSize: unknown, pickerSize: unknown): number {
  return positiveFileSize(measuredSize) || positiveFileSize(pickerSize);
}

async function readLegacyFileInfo(path: string): Promise<LegacyFileInfo> {
  const LegacyFileSystem = await import("expo-file-system/legacy");
  return LegacyFileSystem.getInfoAsync(path);
}

export async function getMobileFileStat(
  path: string,
  pickerSize?: number,
  readInfo: ReadLegacyFileInfo = readLegacyFileInfo,
): Promise<MobileImportFileStat> {
  const fallbackSize = resolveImportFileSize(undefined, pickerSize);
  try {
    const info = await readInfo(path);
    const measuredSize = info.exists && !info.isDirectory ? info.size : undefined;
    return {
      // Some document-provider cache URLs report no size here even though the
      // system picker has already copied and measured the selected file.
      size: resolveImportFileSize(measuredSize, fallbackSize),
      md5: undefined,
      modificationTime:
        info.exists && !info.isDirectory && typeof info.modificationTime === "number"
          ? info.modificationTime * 1000
          : undefined,
    };
  } catch (error) {
    // The picker-owned size is enough to proceed. The subsequent source read
    // or managed-storage copy still validates that actual bytes are available.
    if (fallbackSize > 0) return { size: fallbackSize, md5: undefined };
    throw error;
  }
}

import { Asset } from "expo-asset";
import { useEffect, useMemo, useState } from "react";

function getAvailableAssetUri(assetModule: number): string | undefined {
  const asset = Asset.fromModule(assetModule);
  return asset.localUri || asset.uri || undefined;
}

/**
 * Преобразует встроенные Expo-ассеты в URI, одинаково работающие в dev-клиенте
 * и в собранном приложении. React Native Image с числовым source нестабилен
 * после Fast Refresh, поэтому библиотека использует явный URI.
 */
export function useResolvedAssetUris(assetModules: readonly number[]): ReadonlyMap<number, string> {
  const immediateUris = useMemo(() => {
    const next = new Map<number, string>();
    for (const assetModule of assetModules) {
      const uri = getAvailableAssetUri(assetModule);
      if (uri) next.set(assetModule, uri);
    }
    return next;
  }, [assetModules]);
  const [downloadedUris, setDownloadedUris] = useState<ReadonlyMap<number, string>>(immediateUris);

  useEffect(() => {
    let isCancelled = false;

    setDownloadedUris(immediateUris);
    void Promise.all(
      assetModules.map(async (assetModule) => {
        try {
          const asset = Asset.fromModule(assetModule);
          await asset.downloadAsync();
          const uri = asset.localUri || asset.uri;
          return uri ? ([assetModule, uri] as const) : undefined;
        } catch (error) {
          console.warn("[Library] Failed to resolve bundled cover:", error);
          return undefined;
        }
      }),
    ).then((entries) => {
      if (isCancelled) return;
      const next = new Map(immediateUris);
      for (const entry of entries) {
        if (entry) next.set(entry[0], entry[1]);
      }
      setDownloadedUris(next);
    });

    return () => {
      isCancelled = true;
    };
  }, [assetModules, immediateUris]);

  return downloadedUris;
}

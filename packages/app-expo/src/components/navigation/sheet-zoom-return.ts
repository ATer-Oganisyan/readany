import { useCallback, useEffect, useRef } from "react";
import { Animated } from "react-native";

const preparations = new Map<string, () => void>();

export function registerSheetZoomReturn(sourceId: string, prepare: () => void): () => void {
  preparations.set(sourceId, prepare);
  return () => preparations.delete(sourceId);
}

export function prepareSheetZoomReturn(sourceId?: string): void {
  if (sourceId) preparations.get(sourceId)?.();
}

export function useSheetZoomReturnShadow(sourceId: string) {
  const shadowOpacity = useRef(new Animated.Value(1)).current;
  const prepared = useRef(false);
  const fallback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onZoomReturn = useCallback(() => {
    if (!prepared.current) return;
    prepared.current = false;
    clearTimeout(fallback.current);
    Animated.timing(shadowOpacity, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [shadowOpacity]);

  useEffect(() => {
    const unregister = registerSheetZoomReturn(sourceId, () => {
      prepared.current = true;
      shadowOpacity.setValue(0);
      clearTimeout(fallback.current);
      fallback.current = setTimeout(onZoomReturn, 1200);
    });
    return () => {
      unregister();
      clearTimeout(fallback.current);
    };
  }, [onZoomReturn, shadowOpacity, sourceId]);

  return { shadowOpacity, onZoomReturn };
}

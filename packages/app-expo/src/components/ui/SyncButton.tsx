import { RefreshCwIcon } from "@/components/ui/Icon";
import { PressableScale } from "@/components/ui/PressableScale";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { useSyncStore } from "@readany/core/stores";
import { useCallback, useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";

interface SyncButtonProps {
  size?: number;
  color?: string;
}

export function SyncButton({ size = 20, color }: SyncButtonProps) {
  const syncNow = useSyncStore((s) => s.syncNow);
  const status = useSyncStore((s) => s.status);
  const backendType = useSyncStore((s) => s.backendType);
  const loadConfig = useSyncStore((s) => s.loadConfig);

  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinRef = useRef<Animated.CompositeAnimation | null>(null);

  const isBusy = status !== "idle" && status !== "error";

  useEffect(() => {
    if (!backendType) {
      void loadConfig();
    }
  }, [backendType, loadConfig]);

  useEffect(() => {
    if (isBusy) {
      spinAnim.setValue(0);
      const anim = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      spinRef.current = anim;
      anim.start();
    } else {
      spinRef.current?.stop();
      spinAnim.setValue(0);
    }
  }, [isBusy, spinAnim]);

  // Отдача в момент, когда синхронизация закончилась, а не когда её запустили:
  // причина здесь — результат, а не нажатие. Крутящаяся иконка при этом
  // остаётся единственным обязательным сигналом, вибрация только дополняет её.
  const previousStatusRef = useRef(status);
  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;
    const wasBusy = previousStatus !== "idle" && previousStatus !== "error";
    if (!wasBusy) return;
    if (status === "idle") hapticSuccess();
    else if (status === "error") hapticError();
  }, [status]);

  const handlePress = useCallback(() => {
    if (isBusy) return;
    void syncNow();
  }, [isBusy, syncNow]);

  if (!backendType) return null;

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    // Иконка мелкая, поэтому вжатие глубже обычного — на 0.97 оно на 20pt
    // просто не видно. hitSlop добирает зону касания до 48pt.
    <PressableScale onPress={handlePress} pressedScale={0.88} hitSlop={(48 - size) / 2}>
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <RefreshCwIcon size={size} color={color} />
      </Animated.View>
    </PressableScale>
  );
}

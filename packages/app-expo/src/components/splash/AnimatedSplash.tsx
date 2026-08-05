import { useCallback, useEffect } from "react";
import { useColorScheme } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import SplashLogoDark from "../../../assets/splash-logo-dark.svg";
import SplashLogoLight from "../../../assets/splash-logo.svg";

const LOGO_SIZE = 144;
const LOGO_BOTTOM_GAP = 24;

interface Props {
  appReady: boolean;
  onFinish: () => void;
}

export function AnimatedSplash({ appReady, onFinish }: Props) {
  const isDark = useColorScheme() === "dark";
  const SplashLogo = isDark ? SplashLogoDark : SplashLogoLight;
  const containerOpacity = useSharedValue(1);

  const handleFinish = useCallback(() => {
    onFinish();
  }, [onFinish]);

  useEffect(() => {
    if (!appReady) return;
    const timer = setTimeout(() => {
      containerOpacity.value = withTiming(0, { duration: 180 }, (finished) => {
        if (finished) runOnJS(handleFinish)();
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [appReady, containerOpacity, handleFinish]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          inset: 0,
          zIndex: 9999,
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: LOGO_BOTTOM_GAP,
          backgroundColor: isDark ? "#000000" : "#FFFFFF",
        },
        containerStyle,
      ]}
    >
      <SplashLogo width={LOGO_SIZE} height={LOGO_SIZE} />
    </Animated.View>
  );
}

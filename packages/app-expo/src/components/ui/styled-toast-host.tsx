import { AnimatedNarraFace } from "@/components/chat/animated-narra-face";
import { MishanaerIcon, type MishanaerIconName } from "@/components/ui/Icon";
import { ToastOverlay } from "@/components/ui/toast-overlay";
import { useTheme } from "@/styles/ThemeContext";
import { interfaceFontFamily } from "@deslop/primitives/native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Platform, StyleSheet, View } from "react-native";
import {
  type EntryExitAnimationFunction,
  withSpring,
  SnappySpringConfig,
} from "react-native-reanimated";
import { type ToastAnimation, Toaster } from "sonner-native";

const enter: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ translateY: -20 }] },
    animations: { transform: [{ translateY: withSpring(0, SnappySpringConfig) }] },
  };
};
const animation = { enter } satisfies ToastAnimation;
const iconStyle = {
  alignItems: "center",
  flexShrink: 0,
  height: 24,
  justifyContent: "center",
  width: 24,
} as const;
function Icon({ name, color }: { name: MishanaerIconName; color: string }) {
  return (
    <View pointerEvents="none" style={iconStyle}>
      <MishanaerIcon name={name} size={24} color={color} />
    </View>
  );
}

export function StyledToastHost({ insideReader = false }: { insideReader?: boolean }) {
  const { colors, isDark } = useTheme();
  const background =
    Platform.OS === "ios" && isLiquidGlassAvailable() ? (
      <GlassView
        colorScheme={isDark ? "dark" : "light"}
        glassEffectStyle="regular"
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
    ) : undefined;
  const toaster = (
    <Toaster
      ToasterOverlayWrapper={insideReader ? undefined : ToastOverlay}
      fullWindowOverlay={!insideReader}
      theme={isDark ? "dark" : "light"}
      position="top-center"
      duration={4000}
      visibleToasts={2}
      enableStacking
      richColors={false}
      animation={animation}
      swipeToDismissDirection="horizontal"
      backgroundComponent={background}
      icons={{
        success: <Icon name="check-circle" color={colors.primary60} />,
        error: <Icon name="x-hexagon" color={colors.primary60} />,
        warning: <Icon name="exclamation-triangle" color={colors.primary60} />,
        info: <Icon name="exclamation-circle" color={colors.primary60} />,
        loading: (
          <View pointerEvents="none" style={iconStyle}>
            <AnimatedNarraFace width={23} height={24} color={colors.primary60} />
          </View>
        ),
      }}
      toastOptions={{
        style: {
          backgroundColor: colors.card,
          borderRadius: 24,
          borderCurve: "continuous",
          paddingHorizontal: 20,
        },
        titleStyle: {
          color: colors.cardForeground,
          fontFamily: interfaceFontFamily.regular,
          fontSize: 16,
          fontWeight: "400",
        },
        descriptionStyle: { display: "none" },
        toastContentStyle: { alignItems: "center" },
      }}
    />
  );
  if (!insideReader) return toaster;
  // Sonner positions its children absolutely. Supply a native viewport plane
  // above the reader, with touches outside the notification passing through.
  return (
    <View
      testID="reader-toast-plane"
      collapsable={false}
      pointerEvents="box-none"
      style={{ ...StyleSheet.absoluteFill, zIndex: 9999 }}
    >
      {toaster}
    </View>
  );
}

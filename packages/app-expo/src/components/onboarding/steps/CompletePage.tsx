import { NativeButton } from "@/components/ui/NativeButton";
import { useSettingsStore } from "@/stores";
import { useTheme } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown, SlideInRight } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function CompletePage() {
  const { t } = useTranslation();
  const { completeOnboarding } = useSettingsStore();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const handleStart = () => {
    completeOnboarding();
  };

  return (
    <View style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <Animated.View entering={SlideInRight.duration(500)} style={styles.container}>
        <View style={styles.content}>
          <Animated.Text
            entering={FadeInDown.delay(200).springify()}
            style={[styles.title, { color: colors.foreground }]}
          >
            {t("onboarding.complete.title", "You're All Set!")}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(300).springify()}
            style={[styles.subtitle, { color: colors.mutedForeground }]}
          >
            {t(
              "onboarding.complete.desc",
              "Everything is configured. You can now start adding books, discussing them with AI, and translating texts seamlessly.",
            )}
          </Animated.Text>
        </View>

        <View
          style={[
            styles.footer,
            { backgroundColor: colors.background, paddingBottom: 24 + insets.bottom },
          ]}
        >
          <NativeButton
            label={t("onboarding.complete.start", "Перейти к чтению")}
            onPress={handleStart}
            icon="forward"
            size="large"
            fullWidth
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f8fafc" },
  container: { flex: 1, flexDirection: "column" },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: "#e0e7ff",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 32,
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
  },
  title: {
    fontSize: 36,
    fontWeight: "800",
    color: "#0f172a",
    textAlign: "center",
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 18,
    color: "#64748b",
    textAlign: "center",
    lineHeight: 28,
    paddingHorizontal: 12,
  },
  footer: { padding: 24, paddingBottom: 0, alignItems: "center" },
});

import { Bot, Languages, Search } from "@/components/ui/Icon";
import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { useSettingsStore } from "@/stores";
import { useTheme } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { OnboardingStackParamList } from "../OnboardingNavigator";

type NavProp = NativeStackNavigationProp<OnboardingStackParamList, "Welcome">;

export function WelcomePage() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavProp>();
  const { completeOnboarding } = useSettingsStore();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const handleSkip = () => {
    completeOnboarding();
  };

  const handleNext = () => {
    navigation.navigate("Appearance");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.Text
          entering={FadeInDown.delay(200).springify()}
          style={[styles.title, { color: colors.foreground }]}
        >
          {t("onboarding.welcome.title", "Welcome to ReadAny")}
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.delay(300).springify()}
          style={[styles.subtitle, { color: colors.mutedForeground }]}
        >
          {t(
            "onboarding.welcome.desc",
            "The ultimate intelligent reading experience, uniquely yours.",
          )}
        </Animated.Text>

        <View style={styles.features}>
          {[
            {
              icon: <Bot size={24} color="#6366f1" />,
              title: t("onboarding.welcome.ai", "AI Co-pilot"),
              desc: t("onboarding.welcome.aiDesc", "Discuss books naturally with AI"),
            },
            {
              icon: <Search size={24} color="#10b981" />,
              title: t("onboarding.welcome.search", "Smart Search"),
              desc: t("onboarding.welcome.searchDesc", "Semantic knowledge retrieval"),
            },
            {
              icon: <Languages size={24} color="#f59e0b" />,
              title: t("onboarding.welcome.translate", "Instant Translation"),
              desc: t("onboarding.welcome.translateDesc", "Seamless bilingual reading"),
            },
          ].map((f, i) => (
            <Animated.View
              key={f.title}
              entering={FadeInDown.delay(400 + i * 100).springify()}
              style={styles.featureRow}
            >
              <View style={[styles.featureIcon, { backgroundColor: `${f.icon.props.color}20` }]}>
                {f.icon}
              </View>
              <View style={styles.featureText}>
                <Text style={[styles.featureTitle, { color: colors.foreground }]}>{f.title}</Text>
                <Text style={[styles.featureDesc, { color: colors.mutedForeground }]}>
                  {f.desc}
                </Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: 16 + insets.bottom,
          },
        ]}
      >
        <NativeButton
          label={t("onboarding.skip", "Пропустить")}
          onPress={handleSkip}
          variant="tertiary"
        />
        <NativeButton
          label={t("onboarding.getStarted", "Начать")}
          onPress={handleNext}
          icon="forward"
          size="large"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 40,
    alignItems: "center",
    paddingBottom: 24,
  },
  iconContainer: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: "800", textAlign: "center", marginBottom: 12 },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 24,
    paddingHorizontal: 12,
  },
  features: { width: "100%", marginBottom: 24 },
  featureRow: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  featureText: { flex: 1 },
  featureTitle: { fontSize: 15, fontWeight: "600", marginBottom: 4 },
  featureDesc: { fontSize: 13, lineHeight: 18 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
  },
});

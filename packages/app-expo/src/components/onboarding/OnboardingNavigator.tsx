import { useTheme } from "@/styles/theme";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { View } from "react-native";
import { AppearancePage } from "./steps/AppearancePage";
import { CompletePage } from "./steps/CompletePage";
import { WelcomePage } from "./steps/WelcomePage";

export type OnboardingStackParamList = {
  Welcome: undefined;
  Appearance: undefined;
  AI: undefined;
  Embedding: undefined;
  Translation: undefined;
  Sync: undefined;
  Complete: undefined;
};

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingNavigator() {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: "slide_from_right",
          scrollEdgeEffects: {
            top: "soft",
            bottom: "soft",
            left: "soft",
            right: "soft",
          },
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Screen name="Welcome" component={WelcomePage} />
        <Stack.Screen name="Appearance" component={AppearancePage} />
        <Stack.Screen name="Complete" component={CompletePage} />
      </Stack.Navigator>
    </View>
  );
}

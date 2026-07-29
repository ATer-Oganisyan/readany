import { useTheme } from "@/styles/theme";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { View } from "react-native";
import { WelcomePage } from "./steps/WelcomePage";

export type OnboardingStackParamList = {
  Welcome: undefined;
  Appearance: undefined;
  // Kept in the type because the legacy components remain in the source tree,
  // but intentionally not registered in the Narra onboarding flow.
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
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Screen name="Welcome" component={WelcomePage} />
      </Stack.Navigator>
    </View>
  );
}

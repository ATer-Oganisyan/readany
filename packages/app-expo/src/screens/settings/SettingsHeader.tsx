import type { RootStackParamList } from "@/navigation/RootNavigator";
import { fontFamily, useColors } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useLayoutEffect } from "react";
import { View } from "react-native";

interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

/** Configures the real platform navigation bar for settings and detail screens. */
export function SettingsHeader({ title, right }: Props) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colors = useColors();

  useLayoutEffect(() => {
    nav.setOptions({
      headerShown: true,
      title,
      headerStyle: { backgroundColor: colors.background },
      headerShadowVisible: false,
      headerTintColor: colors.foreground,
      headerTitleStyle: {
        color: colors.foreground,
        fontFamily: fontFamily.semibold,
        fontWeight: "600",
      },
      headerRight: right ? () => <View>{right}</View> : undefined,
    });
  }, [colors.background, colors.foreground, nav, right, title]);

  return null;
}

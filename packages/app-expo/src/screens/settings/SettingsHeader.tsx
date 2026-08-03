import type { RootStackParamList } from "@/navigation/RootNavigator";
import { titleFontFamily, useColors } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useLayoutEffect } from "react";
import { Platform, View } from "react-native";

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
      headerTransparent: Platform.OS === "ios",
      headerStyle: {
        backgroundColor: Platform.OS === "ios" ? "transparent" : colors.background,
      },
      headerShadowVisible: false,
      headerTintColor: colors.foreground,
      headerTitleStyle: {
        color: colors.foreground,
        fontFamily: titleFontFamily,
        fontWeight: "600",
      },
      headerRight: right ? () => <View>{right}</View> : undefined,
    });
  }, [colors.background, colors.foreground, nav, right, title]);

  return null;
}

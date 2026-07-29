import { NativeButton } from "@/components/ui/NativeButton";
import type { NativeButtonIcon } from "@/components/ui/NativeButton.types";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useLayoutEffect, useRef } from "react";
import { Platform, View } from "react-native";

export type NativeHeaderAction = {
  label: string;
  accessibilityLabel?: string;
  icon: NativeButtonIcon;
  sfSymbol: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

function androidActions(actions: NativeHeaderAction[]) {
  if (actions.length === 0) return undefined;

  return () => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      {actions.map((action) => (
        <NativeButton
          key={action.label}
          label=""
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          icon={action.icon}
          size="small"
          variant={action.destructive ? "destructive" : "tertiary"}
          disabled={action.disabled}
          onPress={action.onPress}
        />
      ))}
    </View>
  );
}

function iosActions(actions: NativeHeaderAction[]) {
  if (actions.length === 0) return undefined;

  return () =>
    actions.map((action) => ({
      type: "button" as const,
      label: action.label,
      accessibilityLabel: action.accessibilityLabel ?? action.label,
      icon: { type: "sfSymbol" as const, name: action.sfSymbol as never },
      onPress: action.onPress,
      disabled: action.disabled,
      variant: action.destructive ? ("plain" as const) : undefined,
      tintColor: action.destructive ? "#ff3b30" : undefined,
    }));
}

/** Places actions in UINavigationBar / Android native-stack toolbar. */
export function useNativeHeaderActions({
  title,
  left = [],
  right = [],
}: {
  title?: string;
  left?: NativeHeaderAction[];
  right?: NativeHeaderAction[];
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const leftRef = useRef(left);
  const rightRef = useRef(right);
  leftRef.current = left;
  rightRef.current = right;

  const leftSignature = left
    .map((action) => `${action.label}:${action.icon}:${action.disabled}:${action.destructive}`)
    .join("|");
  const rightSignature = right
    .map((action) => `${action.label}:${action.icon}:${action.disabled}:${action.destructive}`)
    .join("|");

  useLayoutEffect(() => {
    const currentLeft = leftRef.current.map((action, index) => ({
      ...action,
      onPress: () => leftRef.current[index]?.onPress(),
    }));
    const currentRight = rightRef.current.map((action, index) => ({
      ...action,
      onPress: () => rightRef.current[index]?.onPress(),
    }));

    navigation.setOptions({
      ...(title ? { title } : null),
      ...(Platform.OS === "ios"
        ? {
            unstable_headerLeftItems: iosActions(currentLeft),
            unstable_headerRightItems: iosActions(currentRight),
          }
        : {
            headerLeft: androidActions(currentLeft),
            headerRight: androidActions(currentRight),
          }),
    });
  }, [leftSignature, navigation, rightSignature, title]);
}

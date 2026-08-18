import { RNHostView } from "@expo/ui/swift-ui";
import { View } from "react-native";
import {
  MishanaerIcon,
  type MishanaerIconName,
  type MishanaerIconProps,
  resolveSystemIconName,
} from "./MishanaerIcon";

export function HostedMishanaerIcon({
  name,
  systemName,
  variant,
  size = 24,
  color,
}: {
  name?: MishanaerIconName;
  systemName?: string;
  variant?: MishanaerIconProps["variant"];
  size?: number;
  color: string;
}) {
  const iconName = name ?? resolveSystemIconName(systemName ?? "");

  return (
    <RNHostView matchContents>
      <View
        pointerEvents="none"
        style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
      >
        <MishanaerIcon name={iconName} variant={variant} size={size} color={color} />
      </View>
    </RNHostView>
  );
}

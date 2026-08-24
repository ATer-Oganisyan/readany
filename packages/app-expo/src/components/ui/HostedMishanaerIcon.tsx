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
  box,
  color,
}: {
  name?: MishanaerIconName;
  systemName?: string;
  variant?: MishanaerIconProps["variant"];
  size?: number;
  /**
   * Размер площадки под иконкой, когда она служит содержимым нативной кнопки.
   * У SwiftUI зона нажатия равна отрисованному содержимому, а не рамке кнопки:
   * с рамкой снаружи нажимался бы только сам глиф. Поэтому мишень задаётся
   * здесь, а глиф остаётся размером size.
   */
  box?: number;
  color: string;
}) {
  const iconName = name ?? resolveSystemIconName(systemName ?? "");
  const side = box ?? size;

  return (
    <RNHostView matchContents>
      <View
        pointerEvents="none"
        style={{ width: side, height: side, alignItems: "center", justifyContent: "center" }}
      >
        <MishanaerIcon name={iconName} variant={variant} size={size} color={color} />
      </View>
    </RNHostView>
  );
}

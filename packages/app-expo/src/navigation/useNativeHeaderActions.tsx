import { NativeButton } from "@/components/ui/NativeButton";
import type { NativeButtonIcon } from "@/components/ui/NativeButton.types";
import { NativeContextMenuButton } from "@/components/ui/NativeContextMenuButton";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useLayoutEffect, useRef } from "react";
import { Platform, View } from "react-native";

export type NativeHeaderAction = {
  type?: "button";
  label: string;
  accessibilityLabel?: string;
  icon: NativeButtonIcon;
  sfSymbol: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

export type NativeHeaderMenu = {
  type: "menu";
  label: string;
  accessibilityLabel?: string;
  icon: NativeButtonIcon;
  sfSymbol: string;
  disabled?: boolean;
  items: Array<{
    label: string;
    sfSymbol?: string;
    onPress: () => void;
    disabled?: boolean;
    destructive?: boolean;
  }>;
};

export type NativeHeaderItem = NativeHeaderAction | NativeHeaderMenu;

function androidActions(actions: NativeHeaderItem[]) {
  if (actions.length === 0) return undefined;

  return () => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      {actions.map((action) =>
        action.type === "menu" ? (
          <NativeContextMenuButton
            key={action.label}
            accessibilityLabel={action.accessibilityLabel ?? action.label}
            sfSymbol={action.sfSymbol}
            items={action.items.map((item, index) => ({
              key: `${action.label}-${index}`,
              ...item,
            }))}
          />
        ) : (
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
        ),
      )}
    </View>
  );
}

function iosActions(actions: NativeHeaderItem[]) {
  if (actions.length === 0) return undefined;

  return () =>
    actions.map((action) =>
      action.type === "menu"
        ? {
            type: "menu" as const,
            label: action.label,
            accessibilityLabel: action.accessibilityLabel ?? action.label,
            icon: { type: "sfSymbol" as const, name: action.sfSymbol as never },
            disabled: action.disabled,
            menu: {
              items: action.items.map((item) => ({
                type: "action" as const,
                label: item.label,
                icon: item.sfSymbol
                  ? { type: "sfSymbol" as const, name: item.sfSymbol as never }
                  : undefined,
                onPress: item.onPress,
                disabled: item.disabled,
                destructive: item.destructive,
              })),
            },
          }
        : {
            type: "button" as const,
            label: action.label,
            accessibilityLabel: action.accessibilityLabel ?? action.label,
            icon: { type: "sfSymbol" as const, name: action.sfSymbol as never },
            onPress: action.onPress,
            disabled: action.disabled,
            variant: action.destructive ? ("plain" as const) : undefined,
            tintColor: action.destructive ? "#ff3b30" : undefined,
          },
    );
}

/** Places actions in UINavigationBar / Android native-stack toolbar. */
export function useNativeHeaderActions({
  title,
  left = [],
  right = [],
}: {
  title?: string;
  left?: NativeHeaderItem[];
  right?: NativeHeaderItem[];
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const leftRef = useRef(left);
  const rightRef = useRef(right);
  leftRef.current = left;
  rightRef.current = right;

  const leftSignature = left
    .map((action) =>
      action.type === "menu"
        ? `${action.label}:${action.icon}:${action.disabled}:${action.items
            .map((item) => `${item.label}:${item.disabled}:${item.destructive}`)
            .join(",")}`
        : `${action.label}:${action.icon}:${action.disabled}:${action.destructive}`,
    )
    .join("|");
  const rightSignature = right
    .map((action) =>
      action.type === "menu"
        ? `${action.label}:${action.icon}:${action.disabled}:${action.items
            .map((item) => `${item.label}:${item.disabled}:${item.destructive}`)
            .join(",")}`
        : `${action.label}:${action.icon}:${action.disabled}:${action.destructive}`,
    )
    .join("|");
  const actionSignature = `${leftSignature}||${rightSignature}`;

  useLayoutEffect(() => {
    // Reinstall native bar items when their labels or states change.
    void actionSignature;
    const bindCurrentActions = (ref: typeof leftRef) =>
      ref.current.map(
        (action, actionIndex): NativeHeaderItem =>
          action.type === "menu"
            ? {
                ...action,
                items: action.items.map((item, itemIndex) => ({
                  ...item,
                  onPress: () => {
                    const currentAction = ref.current[actionIndex];
                    if (currentAction?.type === "menu") {
                      currentAction.items[itemIndex]?.onPress();
                    }
                  },
                })),
              }
            : {
                ...action,
                onPress: () => {
                  const currentAction = ref.current[actionIndex];
                  if (currentAction?.type !== "menu") currentAction?.onPress();
                },
              },
      );
    const currentLeft = bindCurrentActions(leftRef);
    const currentRight = bindCurrentActions(rightRef);

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
  }, [actionSignature, navigation, title]);
}

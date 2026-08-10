import { avatarGradients } from "@deslop/primitives";
import { roundedFontFamily } from "@deslop/primitives/native";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";

interface InitialsAvatarProps {
  name: string;
  userId: string | number;
  size?: number;
}

function numericUserId(userId: string | number): number {
  if (typeof userId === "number") return Math.abs(userId);

  let hash = 0;
  for (const character of userId) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash;
}

function getInitials(name: string): string {
  const [firstName = "", lastName = ""] = name.trim().split(/\s+/u);
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toLocaleUpperCase();
}

export function InitialsAvatar({ name, userId, size = 40 }: InitialsAvatarProps) {
  const gradient = avatarGradients[numericUserId(userId) % avatarGradients.length];

  return (
    <LinearGradient
      colors={[gradient.top, gradient.bottom]}
      locations={[0, 1]}
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <View pointerEvents="none" style={styles.initialsFrame}>
        <Text style={[styles.initials, { fontSize: Math.round(size / 2.2) }]} numberOfLines={1}>
          {getInitials(name)}
        </Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  avatar: {
    overflow: "hidden",
  },
  initialsFrame: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    width: "100%",
    color: "#FFFFFF",
    fontFamily: roundedFontFamily.bold,
    fontWeight: "700",
    textAlign: "center",
    includeFontPadding: false,
  },
});

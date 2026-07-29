export interface AdaptiveColor {
  name: string;
  light: string;
  dark: string;
}

export interface AvatarGradient {
  name: string;
  top: string;
  bottom: string;
}

export const accentColors: readonly AdaptiveColor[];
export const baseColors: readonly AdaptiveColor[];
export const primaryColors: readonly AdaptiveColor[];
export const elevationColors: readonly AdaptiveColor[];
export const avatarGradients: readonly AvatarGradient[];
export const typographyStyles: readonly Record<string, string | number>[];
export function getColorToken(name: string, mode?: "light" | "dark"): string | undefined;

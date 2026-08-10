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

export const spacingPixels: Readonly<
  Record<2 | 3 | 4 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 14 | 16 | 20 | 22 | 24 | 32 | 44, number>
>;
export const radiusPixels: Readonly<
  Record<
    4 | 5 | 6 | 8 | 10 | 11 | 12 | 13 | 14 | 16 | 18 | 20 | 22 | 25 | 26 | 34 | 36 | "full",
    number
  >
>;

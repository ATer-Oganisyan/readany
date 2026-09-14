import type { ReactElement } from "react";

export interface CharacterProfileSheetProps {
  children: ReactElement;
  backgroundColor: string;
  portraitReady: boolean;
  onDismiss: () => void;
}

export function CharacterProfileSheet({ children }: CharacterProfileSheetProps) {
  return children;
}

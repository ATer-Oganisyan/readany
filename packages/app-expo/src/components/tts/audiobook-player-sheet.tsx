import type { ReactElement } from "react";

export interface AudiobookPlayerSheetProps {
  children: ReactElement;
  onDismiss: () => void;
  backgroundColor: string;
}

export function AudiobookPlayerSheet({ children }: AudiobookPlayerSheetProps) {
  return children;
}

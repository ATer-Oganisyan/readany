import type { ReactNode } from "react";

export interface TTSPageSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

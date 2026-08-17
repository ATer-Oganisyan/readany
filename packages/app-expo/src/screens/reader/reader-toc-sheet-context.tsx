import type { TOCItem } from "@readany/core/types";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface ReaderTOCSheetSession {
  bookId: string;
  toc: TOCItem[];
  currentChapter: string;
  onClose: () => void;
  onSelectTocItem: (href: string) => void;
}

interface ReaderTOCSheetContextValue {
  session: ReaderTOCSheetSession | null;
  register: (session: ReaderTOCSheetSession) => void;
  unregister: (bookId: string) => void;
}

const ReaderTOCSheetContext = createContext<ReaderTOCSheetContextValue | null>(null);

export function ReaderTOCSheetProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ReaderTOCSheetSession | null>(null);

  const register = useCallback((nextSession: ReaderTOCSheetSession) => {
    setSession(nextSession);
  }, []);

  const unregister = useCallback((bookId: string) => {
    setSession((current) => (current?.bookId === bookId ? null : current));
  }, []);

  const value = useMemo(() => ({ session, register, unregister }), [register, session, unregister]);

  return <ReaderTOCSheetContext.Provider value={value}>{children}</ReaderTOCSheetContext.Provider>;
}

export function useReaderTOCSheet() {
  const context = useContext(ReaderTOCSheetContext);
  if (!context) {
    throw new Error("useReaderTOCSheet must be used inside ReaderTOCSheetProvider");
  }
  return context;
}

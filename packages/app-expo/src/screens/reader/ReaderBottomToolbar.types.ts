export interface ReaderBottomToolbarProps {
  progress: number;
  isBookmarked: boolean;
  bottomInset: number;
  foregroundColor: string;
  mutedColor: string;
  accentColor: string;
  isDark: boolean;
  labels: {
    toc: string;
    bookmarks: string;
    notes: string;
    search: string;
    settings: string;
  };
  onSeek: (value: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpenToc: () => void;
  onToggleBookmark: () => void;
  onOpenNotes: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
}

/**
 * useReaderSearch — состояние поиска по книге для вкладки «Поиск»
 * единой панели читалки: запрос с дебаунсом, список совпадений с
 * контекстом, переход к результату.
 */
import type { ReaderSearchResultItem } from "@/hooks/use-reader-bridge";
import { useCallback, useRef, useState } from "react";

export interface ReaderSearchBridge {
  search?: (query: string) => void;
  clearSearch?: () => void;
  goToCFI?: (cfi: string) => void;
}

export interface UseReaderSearchOptions {
  bridge: ReaderSearchBridge;
}

export interface UseReaderSearchResult {
  searchQuery: string;
  searchResultCount: number;
  searchResults: ReaderSearchResultItem[];
  isSearching: boolean;
  handleSearchInput: (query: string) => void;
  selectResult: (cfi: string) => void;
  clearSearch: () => void;
  onSearchComplete: (count: number, results?: ReaderSearchResultItem[]) => void;
}

export function useReaderSearch({ bridge }: UseReaderSearchOptions): UseReaderSearchResult {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResultCount, setSearchResultCount] = useState(0);
  const [searchResults, setSearchResults] = useState<ReaderSearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchInput = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        const trimmed = query.trim();
        if (trimmed) {
          setIsSearching(true);
          bridge.search?.(trimmed);
        } else {
          setSearchResultCount(0);
          setSearchResults([]);
          setIsSearching(false);
          bridge.clearSearch?.();
        }
      }, 300);
    },
    [bridge],
  );

  // Переход к совпадению; подсветка найденного остаётся в тексте
  const selectResult = useCallback(
    (cfi: string) => {
      if (!cfi) return;
      bridge.goToCFI?.(cfi);
    },
    [bridge],
  );

  const clearSearch = useCallback(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    setSearchQuery("");
    setSearchResultCount(0);
    setSearchResults([]);
    setIsSearching(false);
    bridge.clearSearch?.();
  }, [bridge]);

  // Колбэк моста: итог поиска со списком совпадений (pre/match/post)
  const onSearchComplete = useCallback((count: number, results?: ReaderSearchResultItem[]) => {
    setSearchResultCount(count);
    setSearchResults(results ?? []);
    setIsSearching(false);
  }, []);

  return {
    searchQuery,
    searchResultCount,
    searchResults,
    isSearching,
    handleSearchInput,
    selectResult,
    clearSearch,
    onSearchComplete,
  };
}

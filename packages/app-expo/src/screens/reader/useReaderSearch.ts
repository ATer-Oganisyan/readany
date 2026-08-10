/**
 * useReaderSearch — состояние поиска по книге для вкладки «Поиск»
 * единой панели читалки: запрос с дебаунсом, список совпадений с
 * контекстом, переход к результату.
 */
import type { ReaderSearchResultItem } from "@/hooks/use-reader-bridge";
import { useCallback, useEffect, useRef, useState } from "react";

/** Поиск по большой книге идёт в WebView; без потолка спиннер крутился вечно. */
const SEARCH_TIMEOUT_MS = 20_000;

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
  /** Поиск не ответил за отведённое время — спиннер снят, показываем подсказку. */
  searchTimedOut: boolean;
  handleSearchInput: (query: string) => void;
  /** Немедленный запуск по кнопке «искать» на клавиатуре, без ожидания дебаунса. */
  submitSearch: () => void;
  selectResult: (cfi: string) => void;
  clearSearch: () => void;
  onSearchComplete: (count: number, results?: ReaderSearchResultItem[]) => void;
}

export function useReaderSearch({ bridge }: UseReaderSearchOptions): UseReaderSearchResult {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResultCount, setSearchResultCount] = useState(0);
  const [searchResults, setSearchResults] = useState<ReaderSearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTimedOut, setSearchTimedOut] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armSearchTimeout = useCallback(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      searchTimeoutRef.current = null;
      setIsSearching(false);
      setSearchTimedOut(true);
    }, SEARCH_TIMEOUT_MS);
  }, []);

  const runSearch = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) {
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
        setSearchResultCount(0);
        setSearchResults([]);
        setIsSearching(false);
        setSearchTimedOut(false);
        bridge.clearSearch?.();
        return;
      }
      setSearchTimedOut(false);
      setIsSearching(true);
      armSearchTimeout();
      bridge.search?.(trimmed);
    },
    [armSearchTimeout, bridge],
  );

  useEffect(
    () => () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    },
    [],
  );

  const handleSearchInput = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => runSearch(query), 300);
    },
    [runSearch],
  );

  const submitSearch = useCallback(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    runSearch(searchQuery);
  }, [runSearch, searchQuery]);

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
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    setSearchQuery("");
    setSearchResultCount(0);
    setSearchResults([]);
    setIsSearching(false);
    setSearchTimedOut(false);
    bridge.clearSearch?.();
  }, [bridge]);

  // Колбэк моста: итог поиска со списком совпадений (pre/match/post)
  const onSearchComplete = useCallback((count: number, results?: ReaderSearchResultItem[]) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    setSearchResultCount(count);
    setSearchResults(results ?? []);
    setIsSearching(false);
    setSearchTimedOut(false);
  }, []);

  return {
    searchQuery,
    searchResultCount,
    searchResults,
    isSearching,
    searchTimedOut,
    handleSearchInput,
    submitSearch,
    selectResult,
    clearSearch,
    onSearchComplete,
  };
}

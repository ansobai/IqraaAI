import { useEffect, useState } from "react";
import { searchQuran, SearchResult } from "../utils/searchUtils";

export function useQuranSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(() => {
      const searchResults = searchQuran(query);
      setResults(searchResults);
      setIsSearching(false);
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [query]);

  return {
    query,
    setQuery,
    results,
    isSearching,
  };
}

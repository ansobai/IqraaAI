import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BOOKMARKS_KEY } from "../constants/storage";

export type Bookmark = {
  id: string;
  surahId: number;
  pageNumber: number;
  createdAt: string;
};

type BookmarkInput = {
  surahId: number;
  pageNumber: number;
};

const normalizeBookmarks = (raw: unknown): Bookmark[] => {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const cleaned: Bookmark[] = [];

  raw.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const entry = item as Partial<Bookmark>;
    const surahId = Number(entry.surahId);
    const pageNumber = Number(entry.pageNumber);
    const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : "";

    if (!Number.isFinite(surahId) || !Number.isFinite(pageNumber)) return;

    const id = entry.id ?? `${surahId}-${pageNumber}`;
    if (seen.has(id)) return;
    seen.add(id);

    cleaned.push({
      id,
      surahId,
      pageNumber,
      createdAt: createdAt || new Date().toISOString(),
    });
  });

  cleaned.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return cleaned;
};

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(BOOKMARKS_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      setBookmarks(normalizeBookmarks(parsed));
    } catch {
      setBookmarks([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addBookmark = useCallback(
    async ({ surahId, pageNumber }: BookmarkInput) => {
      const nextBookmark: Bookmark = {
        id: `${surahId}-${pageNumber}`,
        surahId,
        pageNumber,
        createdAt: new Date().toISOString(),
      };

      setBookmarks((prev) => {
        if (prev.some((item) => item.id === nextBookmark.id)) {
          return prev;
        }

        const next = [nextBookmark, ...prev];
        AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [],
  );

  const removeBookmark = useCallback(async (id: string) => {
    setBookmarks((prev) => {
      const next = prev.filter((item) => item.id !== id);
      AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      bookmarks,
      isLoading,
      addBookmark,
      removeBookmark,
      refresh,
    }),
    [addBookmark, bookmarks, isLoading, refresh, removeBookmark],
  );

  return value;
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SAVED_QUOTES_KEY } from "../constants/storage";

export type SavedQuote = {
  id: string;
  surahId: number;
  surahName: string;
  verseNumber: string;
  verseText: string;
  pageNumber: number;
  createdAt: string;
};

type SavedQuoteInput = Omit<SavedQuote, "id" | "createdAt">;

export const buildSavedQuoteId = (
  surahId: number,
  verseNumber: string,
  pageNumber: number,
) => `${surahId}-${verseNumber}-${pageNumber}`;

const normalizeSavedQuotes = (raw: unknown): SavedQuote[] => {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const cleaned: SavedQuote[] = [];

  raw.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const entry = item as Partial<SavedQuote>;
    const surahId = Number(entry.surahId);
    const pageNumber = Number(entry.pageNumber);
    const verseNumber =
      typeof entry.verseNumber === "string" ? entry.verseNumber.trim() : "";
    const verseText = typeof entry.verseText === "string" ? entry.verseText : "";
    const surahName =
      typeof entry.surahName === "string" ? entry.surahName.trim() : "";
    const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : "";

    if (!Number.isFinite(surahId) || !Number.isFinite(pageNumber) || !verseNumber) {
      return;
    }

    const id =
      typeof entry.id === "string" && entry.id.length > 0
        ? entry.id
        : buildSavedQuoteId(surahId, verseNumber, pageNumber);

    if (seen.has(id)) return;
    seen.add(id);

    cleaned.push({
      id,
      surahId,
      surahName,
      verseNumber,
      verseText,
      pageNumber,
      createdAt: createdAt || new Date().toISOString(),
    });
  });

  cleaned.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return cleaned;
};

export function useSavedQuotes() {
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const persist = useCallback(async (next: SavedQuote[]) => {
    try {
      await AsyncStorage.setItem(SAVED_QUOTES_KEY, JSON.stringify(next));
    } catch {
      // no-op
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(SAVED_QUOTES_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      setSavedQuotes(normalizeSavedQuotes(parsed));
    } catch {
      setSavedQuotes([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addSavedQuote = useCallback(
    async ({ surahId, surahName, verseNumber, verseText, pageNumber }: SavedQuoteInput) => {
      const id = buildSavedQuoteId(surahId, verseNumber, pageNumber);
      const nextItem: SavedQuote = {
        id,
        surahId,
        surahName,
        verseNumber,
        verseText,
        pageNumber,
        createdAt: new Date().toISOString(),
      };

      setSavedQuotes((prev) => {
        if (prev.some((item) => item.id === id)) {
          return prev;
        }
        const next = [nextItem, ...prev];
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  const removeSavedQuote = useCallback(
    async (id: string) => {
      setSavedQuotes((prev) => {
        const next = prev.filter((item) => item.id !== id);
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  const isSavedQuote = useCallback(
    (id: string) => savedQuotes.some((item) => item.id === id),
    [savedQuotes],
  );

  const toggleSavedQuote = useCallback(
    async (input: SavedQuoteInput) => {
      const id = buildSavedQuoteId(input.surahId, input.verseNumber, input.pageNumber);
      const exists = savedQuotes.some((item) => item.id === id);
      if (exists) {
        await removeSavedQuote(id);
        return false;
      }
      await addSavedQuote(input);
      return true;
    },
    [addSavedQuote, removeSavedQuote, savedQuotes],
  );

  return useMemo(
    () => ({
      savedQuotes,
      isLoading,
      refresh,
      addSavedQuote,
      removeSavedQuote,
      toggleSavedQuote,
      isSavedQuote,
    }),
    [
      addSavedQuote,
      isLoading,
      isSavedQuote,
      refresh,
      removeSavedQuote,
      savedQuotes,
      toggleSavedQuote,
    ],
  );
}

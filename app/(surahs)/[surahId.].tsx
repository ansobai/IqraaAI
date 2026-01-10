// app/(surahs)/[surahId].tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";

import QuranPageView from "../../components/QuranPageView";
import { LAST_READ_PAGE_KEY } from "../../constants/storage";
import { ARABIC_SURAHS } from "../../constants/surahNames";
import {
  MUSHAF_PAGES,
  MUSHAF_SURAH_START_PAGE,
  type MushafPage,
} from "../../utils/mushafData";

// Load static data once
const PAGES = MUSHAF_PAGES as MushafPage[];
const SURAH_MAP = MUSHAF_SURAH_START_PAGE as Record<string, number>;
const FALLBACK_PAGE_INDEX = Math.max(
  PAGES.findIndex((p) => p.pageNumber === 1),
  0
);

export default function SurahScreen() {
  const { surahId } = useLocalSearchParams<{ surahId?: string }>();
  const id = Number(surahId ?? 1); // chapter number 1..114

  const surahNameFromRoute = ARABIC_SURAHS[id];

  // First page number of this surah from surahMap
  const firstPageNumber = useMemo(() => {
    const fromMap = SURAH_MAP[String(id)];
    return fromMap ?? 1;
  }, [id]);

  // Index of that page in PAGES[]
  const initialIndex = useMemo(() => {
    const idx = PAGES.findIndex((p) => p.pageNumber === firstPageNumber);
    return idx === -1 ? 0 : idx;
  }, [firstPageNumber]);

  const [pageIndex, setPageIndex] = useState(initialIndex);
  const hasRestoredRef = useRef(false);

  useEffect(() => {
    let isActive = true;

    const restoreLastPage = async () => {
      try {
        const saved = await AsyncStorage.getItem(LAST_READ_PAGE_KEY);
        if (!isActive) return;

        const savedNumber = saved ? Number(saved) : NaN;
        const savedIndex = Number.isFinite(savedNumber)
          ? PAGES.findIndex((p) => p.pageNumber === savedNumber)
          : -1;

        if (savedIndex >= 0) {
          setPageIndex(savedIndex);
        } else {
          setPageIndex(FALLBACK_PAGE_INDEX);
        }
      } catch {
        if (isActive) setPageIndex(FALLBACK_PAGE_INDEX);
      } finally {
        if (isActive) hasRestoredRef.current = true;
      }
    };

    restoreLastPage();

    return () => {
      isActive = false;
    };
  }, []);

  // Reset index if surahId changes after initial restore
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    setPageIndex(initialIndex);
  }, [initialIndex]);

  const page = PAGES[pageIndex] ?? PAGES[FALLBACK_PAGE_INDEX];

  const handleNextPage = () => {
    setPageIndex((prev) => (prev < PAGES.length - 1 ? prev + 1 : prev));
  };

  const handlePrevPage = () => {
    setPageIndex((prev) => (prev > 0 ? prev - 1 : prev));
  };

  // NEW: jump directly to first page of a given surah
  const handleJumpToSurah = (targetSurahId: number) => {
    const startPageNumber = SURAH_MAP[String(targetSurahId)];
    if (!startPageNumber) return;

    const idx = PAGES.findIndex((p) => p.pageNumber === startPageNumber);
    if (idx === -1) return;

    setPageIndex(idx);
  };

  useEffect(() => {
    if (!page?.pageNumber) return;
    AsyncStorage.setItem(LAST_READ_PAGE_KEY, String(page.pageNumber)).catch(
      () => {}
    );
  }, [page?.pageNumber]);

  // Use current page's surah name for the title (so it updates when we jump)
  const currentSurahName =
    page?.surahs?.[0]?.titleAr ?? surahNameFromRoute ?? "الفاتحة";

  return (
    <View className="flex-1 bg-[#FFFDF5]">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Quran page view (handles gestures: pinch, swipe, double-tap) */}
      <View className="flex-1">
        <QuranPageView
          page={page}
          onNextPage={handleNextPage}
          onPrevPage={handlePrevPage}
          onJumpToSurah={handleJumpToSurah} // <-- pass to mini-view slider
        />
      </View>
    </View>
  );
}

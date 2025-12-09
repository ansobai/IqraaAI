// app/(surahs)/[surahId].tsx
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import ready from "../../assets/data/quran-ready.json";
import QuranPageView from "../../components/QuranPageView";
import { ARABIC_SURAHS } from "../../constants/surahNames";
import type { ReadyPage } from "../../utils/quranProcessor";

// Load static data once
const readyData = ready as any;
const PAGES = readyData.pages as ReadyPage[];
const SURAH_MAP = readyData.surahMap as Record<string, number>;

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

  // Reset index if surahId changes
  useEffect(() => {
    setPageIndex(initialIndex);
  }, [initialIndex]);

  const page = PAGES[pageIndex];

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

  // Use current page's surah name for the title (so it updates when we jump)
  const currentSurahName =
    page?.verses?.[0]?.surah ?? surahNameFromRoute ?? "الفاتحة";

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFDF5" }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Quran page view (handles gestures: pinch, swipe, double-tap) */}
      <View style={{ flex: 1 }}>
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

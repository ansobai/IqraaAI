// app/(surahs)/[surahId].tsx
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

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

  const surahName = ARABIC_SURAHS[id];

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

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFDF5" }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Optional: Surah title using the Arabic names constant */}
      <View
        style={{
          paddingTop: 40,
          paddingBottom: 8,
          alignItems: "center",
        }}
      >
        <Text
          style={{
            fontFamily: "Amiri",
            fontSize: 20,
            color: "#1F1F1F",
          }}
        >
          سورة {surahName}
        </Text>
      </View>

      {/* Quran page view (handles gestures: pinch, swipe, double-tap) */}
      <View style={{ flex: 1 }}>
        <QuranPageView
          page={page}
          onNextPage={handleNextPage}
          onPrevPage={handlePrevPage}
        />
      </View>
    </View>
  );
}

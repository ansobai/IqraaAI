// app/(surahs)/[surahId].tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, FlatList } from "react-native";

import QuranPager from "../../components/QuranPager";
import QuranPageView from "../../components/QuranPageView";
import SurahBanner from "../../components/SurahBanner";
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

const SURAHS_DATA = ARABIC_SURAHS.map((name, i) => ({ id: i, name })).filter(
  (s) => s.id > 0
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
  const [isMini, setIsMini] = useState(false);
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

  // NEW: jump directly to first page of a given surah
  const handleJumpToSurah = (targetSurahId: number) => {
    const startPageNumber = SURAH_MAP[String(targetSurahId)];
    if (!startPageNumber) return;

    const idx = PAGES.findIndex((p) => p.pageNumber === startPageNumber);
    if (idx === -1) return;

    setPageIndex(idx);
  };

  const handleToggleMiniMode = () => {
    setIsMini((prev) => !prev);
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

      {/* Quran pager (handles gestures: pinch, swipe, double-tap) */}
      <View className="flex-1">
        <QuranPager
          data={PAGES}
          initialIndex={pageIndex}
          onIndexChange={setPageIndex}
          renderItem={({ item }) => (
            <QuranPageView
              page={item}
              isMini={isMini}
              onToggleMiniMode={handleToggleMiniMode}
            />
          )}
        />
      </View>

      {/* MINI MODE CONTROLS – Moved here for performance */}
      {isMini && (
        <View
          pointerEvents="box-none"
          className="absolute left-0 right-0 top-10 items-center z-50"
        >
          {/* SEARCH BAR */}
          <View className="w-[90%] mb-3">
            <View className="flex-row-reverse items-center bg-[#F4EFE4] rounded-3xl px-4 py-2">
              <Text className="flex-1 text-right text-[#999] font-uthmanic">
                ابحث في القرآن...
              </Text>
            </View>
          </View>

          {/* SURAH SLIDER (FlatList) */}
          <View style={{ height: 80 }}>
            <FlatList
              data={SURAHS_DATA}
              keyExtractor={(item) => item.id.toString()}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: 24,
                alignItems: "center",
              }}
              inverted
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              renderItem={({ item }) => {
                const active = item.name === currentSurahName;
                return (
                  <Pressable
                    onPress={() => handleJumpToSurah(item.id)}
                    className="items-center mx-3"
                  >
                    <SurahBanner
                      label={item.name}
                      size="md"
                      textStyle={{
                        color: active ? "#C79A3A" : "#1F1F1F",
                      }}
                    />
                    {/* underline for active surah */}
                    <View className="h-[3px] w-10 mt-1 rounded-full bg-transparent">
                      {active && (
                        <View className="h-[3px] w-full bg-[#C79A3A] rounded-full" />
                      )}
                    </View>
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

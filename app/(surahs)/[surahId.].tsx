// app/(surahs)/[surahId].tsx
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import
  {
    InteractionManager,
    LayoutChangeEvent,
    TextInput,
    View,
  } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import QuranReader from "../../components/QuranReader";
import SurahCarousel from "../../components/SurahCarousel";
import { LAST_READ_PAGE_KEY } from "../../constants/storage";
import { ARABIC_SURAHS } from "../../constants/surahNames";
import
  {
    MUSHAF_PAGES,
    MUSHAF_SURAH_START_PAGE,
    type MushafPage,
  } from "../../utils/mushafData";
import
  {
    QURAN_PAGE_NUMBERS,
    prefetchQuranPageSvgs,
  } from "../../utils/quranSvgRegistry";

// Load static data once
const PAGES = MUSHAF_PAGES as MushafPage[];
const SURAH_MAP = MUSHAF_SURAH_START_PAGE as Record<string, number>;
const FALLBACK_PAGE_INDEX = Math.max(
  PAGES.findIndex((p) => p.pageNumber === 1),
  0
);
const FALLBACK_PAGE_NUMBER = PAGES[FALLBACK_PAGE_INDEX]?.pageNumber ?? 1;

const PAGE_NUMBERS = PAGES.map((page) => page.pageNumber);
const SURAH_ITEMS = ARABIC_SURAHS.map((name, id) => ({ id, name })).filter(
  (item) => item.id > 0
);

const PAGE_ASPECT_RATIO = 729.448 / 510.236;
const PAGE_HORIZONTAL_PADDING = 8;
const PAGE_TOP_PADDING = 0;
const PAGE_BOTTOM_PADDING = 0;
const NORMAL_SCALE = 1.36;
const FIRST_PAGES_SCALE = NORMAL_SCALE;
const MINI_SCALE = 0.85;
const MINI_TRIGGER_SCALE = 0.7;
const MIN_PINCH_SCALE = 0.5;
const MAX_PINCH_SCALE = 3;

export default function SurahScreen() {
  const { surahId } = useLocalSearchParams<{ surahId?: string }>();
  const id = Number(surahId ?? 1); // chapter number 1..114
  const router = useRouter();

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
  const [didRestorePage, setDidRestorePage] = useState(false);
  const [restoredPageNumber, setRestoredPageNumber] = useState<number | null>(
    null
  );
  const backgroundPrefetchCancelRef = useRef<(() => void) | null>(null);
  const [isMini, setIsMini] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const pinchScale = useSharedValue(1);
  const pageScaleValue = useSharedValue(NORMAL_SCALE);

  const toggleMiniMode = useCallback(() => {
    setIsMini((prev) => !prev);
  }, []);

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
          setRestoredPageNumber(savedNumber);
        } else {
          setPageIndex(FALLBACK_PAGE_INDEX);
          setRestoredPageNumber(FALLBACK_PAGE_NUMBER);
        }
      } catch {
        if (isActive) {
          setPageIndex(FALLBACK_PAGE_INDEX);
          setRestoredPageNumber(FALLBACK_PAGE_NUMBER);
        }
      } finally {
        if (isActive) {
          hasRestoredRef.current = true;
          setDidRestorePage(true);
        }
      }
    };

    restoreLastPage();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    const pageNumber = PAGES[pageIndex]?.pageNumber;
    if (!pageNumber) return;

    const nearbyPages = Array.from({ length: 11 }, (_, offset) => {
      return pageNumber - 2 + offset;
    });
    prefetchQuranPageSvgs(nearbyPages);
  }, [pageIndex]);

  useEffect(() => {
    if (!didRestorePage || backgroundPrefetchCancelRef.current) return;

    const pageNumber = restoredPageNumber ?? FALLBACK_PAGE_NUMBER;

    const nearbySet = new Set(
      Array.from({ length: 11 }, (_, offset) => pageNumber - 2 + offset)
    );
    const remainingPages = QURAN_PAGE_NUMBERS.filter(
      (num) => !nearbySet.has(num)
    );

    const interactionHandle = InteractionManager.runAfterInteractions(() => {
      backgroundPrefetchCancelRef.current = prefetchQuranPageSvgs(
        remainingPages,
        {
          chunkSize: 8,
          staggerMs: 12,
        }
      );
    });

    return () => {
      interactionHandle?.cancel?.();
      backgroundPrefetchCancelRef.current?.();
      backgroundPrefetchCancelRef.current = null;
    };
  }, [didRestorePage, restoredPageNumber]);

  // Reset index if surahId changes after initial restore
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    setPageIndex(initialIndex);
  }, [initialIndex]);

  const page = PAGES[pageIndex] ?? PAGES[FALLBACK_PAGE_INDEX];

  useEffect(() => {
    if (isMini) {
      pinchScale.value = 1;
    }
  }, [isMini, pinchScale]);

  const pageScale = useMemo(() => {
    const pageNumber = page?.pageNumber ?? FALLBACK_PAGE_NUMBER;
    const baseScale =
      pageNumber <= 2 ? FIRST_PAGES_SCALE : NORMAL_SCALE;
    return isMini ? baseScale * MINI_SCALE : baseScale;
  }, [isMini, page?.pageNumber]);

  useEffect(() => {
    pageScaleValue.value = pageScale;
  }, [pageScale, pageScaleValue]);

  useEffect(() => {
    if (!page?.pageNumber) return;
    AsyncStorage.setItem(LAST_READ_PAGE_KEY, String(page.pageNumber)).catch(
      () => {}
    );
  }, [page?.pageNumber]);

  const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport((prev) => {
      if (prev.width === width && prev.height === height) return prev;
      return { width, height };
    });
  }, []);

  const pageSize = useMemo(() => {
    const maxWidth = Math.max(
      0,
      viewport.width - PAGE_HORIZONTAL_PADDING * 2
    );
    const maxHeight = Math.max(
      0,
      viewport.height - (PAGE_TOP_PADDING + PAGE_BOTTOM_PADDING)
    );
    if (!maxWidth || !maxHeight) return { width: 0, height: 0 };

    // Fill as much vertical space as possible (like common Quran apps), then clamp to width.
    const targetHeight = maxHeight;
    let height = targetHeight;
    let width = height / PAGE_ASPECT_RATIO;

    if (height > maxHeight) {
      height = maxHeight;
      width = height / PAGE_ASPECT_RATIO;
    }

    if (width > maxWidth) {
      width = maxWidth;
      height = width * PAGE_ASPECT_RATIO;
    }

    return { width, height };
  }, [viewport]);

  const animatedStyle = useAnimatedStyle(() => {
    const scale = pageScaleValue.value * pinchScale.value;
    return {
      transform: [{ scale }],
    };
  });

  const pinch = Gesture.Pinch()
    .enabled(!isMini)
    .onUpdate((event) => {
      let next = event.scale;

      if (next < MIN_PINCH_SCALE) next = MIN_PINCH_SCALE;
      if (next > MAX_PINCH_SCALE) next = MAX_PINCH_SCALE;

      pinchScale.value = next;
    })
    .onEnd(() => {
      if (pinchScale.value < MINI_TRIGGER_SCALE) {
        pinchScale.value = 1;
        runOnJS(setIsMini)(true);
      } else if (pinchScale.value < 1) {
        pinchScale.value = 1;
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(250)
    .onEnd(() => {
      runOnJS(toggleMiniMode)();
    });

  const gesture = Gesture.Simultaneous(pinch, doubleTap);

  const handleSelectSurah = useCallback(
    (surahNumber: number) => {
      router.replace(`/(surahs)/${surahNumber}`);
    },
    [router]
  );

  const carouselIndex = Math.max(
    0,
    Math.min(SURAH_ITEMS.length - 1, id - 1)
  );

  return (
    <SafeAreaView className="flex-1 bg-[#FFFDF5]" edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      {isMini ? (
        <View className="pt-12 pb-2">
          <View className="px-5 mb-4">
            <View className="flex-row-reverse bg-[#F0EBE0] rounded-2xl px-4 py-2 items-center gap-2">
              <Ionicons name="search" size={20} color="#999" />
              <TextInput
                placeholder="بحث في السور..."
                placeholderTextColor="#999"
                className="flex-1 text-right text-base text-[#1F1F1F] font-uthmanic"
              />
            </View>
          </View>

          <View className="h-20">
            <SurahCarousel
              data={SURAH_ITEMS}
              onSelect={handleSelectSurah}
              initialScrollIndex={carouselIndex}
            />
          </View>
        </View>
      ) : null}

      <View
        className="flex-1 items-center justify-center"
        onLayout={handleViewportLayout}
      >
        <View
          className="w-full items-center"
          style={{
            paddingHorizontal: PAGE_HORIZONTAL_PADDING,
            paddingTop: PAGE_TOP_PADDING,
            paddingBottom: PAGE_BOTTOM_PADDING,
          }}
        >
          <GestureDetector gesture={gesture}>
            <Animated.View
              style={[
                {
                  width: pageSize.width,
                  height: pageSize.height,
                  alignSelf: "center",
                  overflow: "visible",
                },
                animatedStyle,
              ]}
            >
              {pageSize.width > 0 && pageSize.height > 0 ? (
                <QuranReader
                  pages={PAGE_NUMBERS}
                  pageIndex={pageIndex}
                  onPageIndexChange={setPageIndex}
                  hideSideMarkers={!isMini}
                  style={{
                    width: pageSize.width,
                    height: pageSize.height,
                  }}
                />
              ) : null}
            </Animated.View>
          </GestureDetector>
        </View>
      </View>
    </SafeAreaView>
  );
}

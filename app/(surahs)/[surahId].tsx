// app/(surahs)/[surahId].tsx
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  Keyboard,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import QuranPage from "../../components/QuranPage";
import QuranPager from "../../components/QuranPager";
import SurahCarousel from "../../components/SurahCarousel";
import { LAST_READ_PAGE_KEY } from "../../constants/storage";
import { ARABIC_SURAHS } from "../../constants/surahNames";
import { useQuranSearch } from "../../hooks/useQuranSearch";
import {
  MUSHAF_PAGES,
  MUSHAF_SURAH_START_PAGE,
  getSurahIdForPageNumber,
  type MushafPage,
} from "../../utils/mushafData";
import {
  QURAN_PAGE_NUMBERS,
  prefetchQuranPageSvgs,
} from "../../utils/quranSvgRegistry";
import { SearchResult } from "../../utils/searchUtils";
import { toArabicNumber } from "../../utils/toArabicNumbers";

// Load static data once
const PAGES = MUSHAF_PAGES as MushafPage[];
const SURAH_MAP = MUSHAF_SURAH_START_PAGE as Record<string, number>;
const FALLBACK_PAGE_INDEX = Math.max(
  PAGES.findIndex((p) => p.pageNumber === 1),
  0,
);
const FALLBACK_PAGE_NUMBER = PAGES[FALLBACK_PAGE_INDEX]?.pageNumber ?? 1;

const PAGE_NUMBERS = PAGES.map((page) => page.pageNumber);
const SURAH_ITEMS = ARABIC_SURAHS.map((name, id) => ({ id, name })).filter(
  (item) => item.id > 0,
);

const PAGE_ASPECT_RATIO = 729.448 / 510.236;
const PAGE_HORIZONTAL_PADDING = 8;
const PAGE_TOP_PADDING = 0;
const PAGE_BOTTOM_PADDING = 0;
const LANDSCAPE_HORIZONTAL_PADDING = 0;
const LANDSCAPE_TOP_PADDING = 0;
const LANDSCAPE_BOTTOM_PADDING = 0;
const NORMAL_SCALE = 1.36;
const FIRST_PAGES_SCALE = NORMAL_SCALE;
const MINI_SCALE = 0.85;
const MINI_TRIGGER_SCALE = 0.7;
const MIN_PINCH_SCALE = 0.5;
const MAX_PINCH_SCALE = 3;
const DOUBLE_TAP_WINDOW_MS = 180;
const DOUBLE_TAP_MAX_DISTANCE = 12;
const DOUBLE_TAP_MAX_DURATION = 120;
const PREFETCH_WINDOW = 3;
const BACKGROUND_PREFETCH_CHUNK_SIZE = 1;
const BACKGROUND_PREFETCH_STAGGER_MS = 24;
const BACKGROUND_PREFETCH_DELAY_MS = 400;

const getNearbyPages = (pageNumber: number, windowSize: number) =>
  Array.from(
    { length: windowSize * 2 + 1 },
    (_, offset) => pageNumber - windowSize + offset,
  );

export default function SurahScreen() {
  const {
    surahId,
    startAt,
    page: pageParam,
  } = useLocalSearchParams<{
    surahId?: string;
    startAt?: string;
    page?: string;
  }>();
  const parsedId = Number(surahId ?? 1);
  const id = Number.isFinite(parsedId) && parsedId > 0 ? parsedId : 1; // chapter number 1..114
  const router = useRouter();
  const forceFirstPage = startAt === "first";

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
    null,
  );
  const backgroundPrefetchCancelRef = useRef<(() => void) | null>(null);
  const [isMini, setIsMini] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const windowDimensions = useWindowDimensions();
  const isLandscape = windowDimensions.width > windowDimensions.height;
  const { query, setQuery, results, isSearching } = useQuranSearch();

  const pinchScale = useSharedValue(1);
  const baseScaleValue = useSharedValue(NORMAL_SCALE);
  const miniModeValue = useSharedValue(0);
  const lastTapTimestamp = useSharedValue(0);
  const markerMaskProgress = useDerivedValue(() =>
    withTiming(miniModeValue.value ? 0 : 1, { duration: 160 }),
  );

  const setMiniMode = useCallback((next: boolean) => {
    setIsMini(next);
  }, []);

  useEffect(() => {
    let isActive = true;

    const restoreLastPage = async () => {
      try {
        const saved = await AsyncStorage.getItem(LAST_READ_PAGE_KEY);
        if (!isActive) return;

        if (pageParam) {
          const targetPage = Number(pageParam);
          const targetIndex = PAGES.findIndex(
            (p) => p.pageNumber === targetPage,
          );
          if (targetIndex !== -1) {
            setPageIndex(targetIndex);
            setRestoredPageNumber(targetPage);
            return;
          }
        }

        const savedNumber = saved ? Number(saved) : NaN;
        if (forceFirstPage) {
          setPageIndex(initialIndex);
          setRestoredPageNumber(
            PAGES[initialIndex]?.pageNumber ?? FALLBACK_PAGE_NUMBER,
          );
          return;
        }

        const savedIndex = Number.isFinite(savedNumber)
          ? PAGES.findIndex((p) => p.pageNumber === savedNumber)
          : -1;
        const savedSurahId = Number.isFinite(savedNumber)
          ? getSurahIdForPageNumber(savedNumber)
          : null;

        if (savedIndex >= 0 && savedSurahId === id) {
          setPageIndex(savedIndex);
          setRestoredPageNumber(savedNumber);
        } else {
          setPageIndex(initialIndex);
          setRestoredPageNumber(
            PAGES[initialIndex]?.pageNumber ?? FALLBACK_PAGE_NUMBER,
          );
        }
      } catch {
        if (isActive) {
          setPageIndex(initialIndex);
          setRestoredPageNumber(
            PAGES[initialIndex]?.pageNumber ?? FALLBACK_PAGE_NUMBER,
          );
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

    const nearbyPages = getNearbyPages(pageNumber, PREFETCH_WINDOW);
    prefetchQuranPageSvgs(nearbyPages);
  }, [pageIndex]);

  useEffect(() => {
    if (!didRestorePage || backgroundPrefetchCancelRef.current) return;

    const pageNumber = restoredPageNumber ?? FALLBACK_PAGE_NUMBER;

    const nearbySet = new Set(getNearbyPages(pageNumber, PREFETCH_WINDOW));
    const remainingPages = QURAN_PAGE_NUMBERS.filter(
      (num) => !nearbySet.has(num),
    );

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const interactionHandle = InteractionManager.runAfterInteractions(() => {
      timeoutId = setTimeout(() => {
        backgroundPrefetchCancelRef.current = prefetchQuranPageSvgs(
          remainingPages,
          {
            chunkSize: BACKGROUND_PREFETCH_CHUNK_SIZE,
            staggerMs: BACKGROUND_PREFETCH_STAGGER_MS,
          },
        );
      }, BACKGROUND_PREFETCH_DELAY_MS);
    });

    return () => {
      interactionHandle?.cancel?.();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      backgroundPrefetchCancelRef.current?.();
      backgroundPrefetchCancelRef.current = null;
    };
  }, [didRestorePage, restoredPageNumber]);

  // Reset index if surahId or page param changes after initial restore
  useEffect(() => {
    if (!hasRestoredRef.current) return;

    if (pageParam) {
      const targetPage = Number(pageParam);
      const targetIndex = PAGES.findIndex((p) => p.pageNumber === targetPage);
      if (targetIndex !== -1) {
        setPageIndex(targetIndex);
        setRestoredPageNumber(targetPage);
        return;
      }
    }

    setPageIndex(initialIndex);
  }, [initialIndex, pageParam]);

  const page = PAGES[pageIndex] ?? PAGES[FALLBACK_PAGE_INDEX];

  useEffect(() => {
    if (isMini) {
      pinchScale.value = 1;
    }
  }, [isMini, pinchScale]);

  useEffect(() => {
    if (!isLandscape) return;
    pinchScale.value = 1;
    if (isMini) {
      miniModeValue.value = 0;
      setIsMini(false);
    }
  }, [isLandscape, isMini, miniModeValue, pinchScale]);

  const baseScale = useMemo(() => {
    if (isLandscape) return 1;
    const pageNumber = page?.pageNumber ?? FALLBACK_PAGE_NUMBER;
    return pageNumber <= 2 ? FIRST_PAGES_SCALE : NORMAL_SCALE;
  }, [isLandscape, page?.pageNumber]);

  useEffect(() => {
    baseScaleValue.value = baseScale;
  }, [baseScale, baseScaleValue]);

  useEffect(() => {
    if (!page?.pageNumber) return;
    AsyncStorage.setItem(LAST_READ_PAGE_KEY, String(page.pageNumber)).catch(
      () => {},
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
    const layoutWidth = viewport.width || windowDimensions.width;
    const layoutHeight = viewport.height || windowDimensions.height;
    if (!layoutWidth || !layoutHeight) return { width: 0, height: 0 };

    if (isLandscape) {
      const width = Math.max(0, layoutWidth - LANDSCAPE_HORIZONTAL_PADDING * 2);
      const height = width * PAGE_ASPECT_RATIO;
      return { width, height };
    }

    const maxWidth = Math.max(0, layoutWidth - PAGE_HORIZONTAL_PADDING * 2);
    const maxHeight = Math.max(
      0,
      layoutHeight - (PAGE_TOP_PADDING + PAGE_BOTTOM_PADDING),
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
  }, [isLandscape, viewport, windowDimensions.height, windowDimensions.width]);

  const animatedStyle = useAnimatedStyle(() => {
    const miniScale = miniModeValue.value ? MINI_SCALE : 1;
    const scale = baseScaleValue.value * miniScale * pinchScale.value;
    return {
      transform: [{ scale }],
    };
  });

  const gesturesEnabled = !isLandscape;

  const pinch = Gesture.Pinch()
    .enabled(!isMini && gesturesEnabled)
    .onUpdate((event) => {
      let next = event.scale;

      if (next < MIN_PINCH_SCALE) next = MIN_PINCH_SCALE;
      if (next > MAX_PINCH_SCALE) next = MAX_PINCH_SCALE;

      pinchScale.value = next;
    })
    .onEnd(() => {
      if (pinchScale.value < MINI_TRIGGER_SCALE) {
        pinchScale.value = 1;
        miniModeValue.value = 1;
        runOnJS(setMiniMode)(true);
      } else if (pinchScale.value < 1) {
        pinchScale.value = 1;
      }
    });

  const doubleTap = Gesture.Tap()
    .enabled(gesturesEnabled)
    .maxDistance(DOUBLE_TAP_MAX_DISTANCE)
    .maxDuration(DOUBLE_TAP_MAX_DURATION)
    .onStart(() => {
      const now = Date.now();
      if (now - lastTapTimestamp.value <= DOUBLE_TAP_WINDOW_MS) {
        lastTapTimestamp.value = 0;
        const next = miniModeValue.value === 0;
        miniModeValue.value = next ? 1 : 0;
        pinchScale.value = 1;
        runOnJS(setMiniMode)(next);
        return;
      }

      lastTapTimestamp.value = now;
    });

  const renderPage = useCallback(
    ({ item }: { item: number; index: number }) => (
      <QuranPage
        pageNumber={item}
        markerMaskProgress={markerMaskProgress}
        pageWidth={pageSize.width}
      />
    ),
    [markerMaskProgress, pageSize.width],
  );

  const getFirstPageIndexForSurah = useCallback((surahNumber: number) => {
    const firstPage = SURAH_MAP[String(surahNumber)] ?? FALLBACK_PAGE_NUMBER;
    const idx = PAGES.findIndex((p) => p.pageNumber === firstPage);
    return idx === -1 ? FALLBACK_PAGE_INDEX : idx;
  }, []);

  const handleSelectSurah = useCallback(
    (surahNumber: number) => {
      setPageIndex(getFirstPageIndexForSurah(surahNumber));
      router.replace({
        pathname: "/(surahs)/[surahId]",
        params: {
          surahId: String(surahNumber),
          startAt: "first",
        },
      });
    },
    [getFirstPageIndexForSurah, router],
  );

  const handleSearchResultPress = useCallback(
    (result: SearchResult) => {
      setQuery("");
      Keyboard.dismiss();

      if (result.type === "surah") {
        handleSelectSurah(result.id);
      } else {
        const targetIndex = PAGES.findIndex(
          (p) => p.pageNumber === result.pageNumber,
        );
        if (targetIndex !== -1) {
          setPageIndex(targetIndex);
          setRestoredPageNumber(result.pageNumber);
        }
        router.replace({
          pathname: "/(surahs)/[surahId]",
          params: {
            surahId: String(result.surahId),
            page: String(result.pageNumber),
          },
        });
      }

      if (isMini) {
        miniModeValue.value = 0;
        setIsMini(false);
      }
    },
    [
      handleSelectSurah,
      isMini,
      miniModeValue,
      router,
      setQuery,
      setRestoredPageNumber,
    ],
  );

  const carouselIndex = Math.max(0, Math.min(SURAH_ITEMS.length - 1, id - 1));
  const horizontalPadding = isLandscape
    ? LANDSCAPE_HORIZONTAL_PADDING
    : PAGE_HORIZONTAL_PADDING;
  const topPadding = isLandscape ? LANDSCAPE_TOP_PADDING : PAGE_TOP_PADDING;
  const bottomPadding = isLandscape
    ? LANDSCAPE_BOTTOM_PADDING
    : PAGE_BOTTOM_PADDING;

  return (
    <SafeAreaView className="flex-1 bg-[#FFFDF5]" edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      {isMini ? (
        <View
          className="pt-12 pb-2"
          pointerEvents="box-none"
          style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 5 }}
        >
          <View className="px-5 mb-4">
            <View className="flex-row-reverse bg-[#F0EBE0] rounded-2xl px-4 py-2 items-center gap-2">
              <Ionicons name="search" size={20} color="#999" />
              <TextInput
                placeholder="بحث في السور..."
                placeholderTextColor="#999"
                className="flex-1 text-right text-base text-[#1F1F1F] font-uthmanic"
                value={query}
                onChangeText={setQuery}
              />
            </View>
          </View>

          {query.length > 0 ? (
            <View
              className="mb-4 w-full bg-white rounded-2xl shadow-lg border border-[#E8E1D1] overflow-hidden"
              style={{ maxHeight: windowDimensions.height * 0.55 }}
            >
              {isSearching ? (
                <View className="py-6 items-center justify-center">
                  <ActivityIndicator color="#2E8B57" />
                </View>
              ) : results.length === 0 ? (
                <View className="py-6 items-center justify-center px-5">
                  <Text className="text-[#1F1F1F] font-uthmanic text-2xl">
                    لا توجد نتائج
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={results}
                  keyExtractor={(item, index) => index.toString()}
                  contentContainerClassName="py-2"
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => {
                    const rowClassName =
                      item.type === "verse"
                        ? "px-4 py-4 min-h-[72px] border-b border-[#F0EBE0] flex-row-reverse items-center justify-between active:bg-[#F9F9F9]"
                        : "px-4 py-3 border-b border-[#F0EBE0] flex-row-reverse items-center justify-between active:bg-[#F9F9F9]";
                    return (
                      <Pressable
                        onPress={() => handleSearchResultPress(item)}
                        className={rowClassName}
                      >
                      {item.type === "surah" ? (
                        <View className="flex-row-reverse items-center gap-3">
                          <View className="w-8 h-8 rounded-full bg-[#E8E1D1] items-center justify-center">
                            <Text className="text-[#8F7E5E] font-bold text-base">
                              {toArabicNumber(item.id)}
                            </Text>
                          </View>
                          <Text className="text-2xl text-[#1F1F1F] font-uthmanic font-bold">
                            سورة {item.name}
                          </Text>
                        </View>
                      ) : (
                        <View className="flex-1">
                          <View className="flex-row-reverse items-center gap-1 mb-0">
                            <Text className="text-xl text-[#2E8B57] font-bold font-uthmanic">
                              سورة {item.surahName}
                            </Text>
                            <Text className="text-2xl text-[#999] font-uthmanic">
                              {toArabicNumber(Number(item.verseNumber))}
                            </Text>
                          </View>
                          <Text
                            className="text-xl text-[#1F1F1F] font-uthmanic text-right"
                            numberOfLines={1}
                            ellipsizeMode="clip"
                          >
                            {item.text}
                          </Text>
                        </View>
                      )}
                      <Ionicons name="chevron-back" size={16} color="#CCC" />
                      </Pressable>
                    );
                  }}
                />
              )}
            </View>
          ) : null}

          {query.length === 0 ? (
            <View className="h-20">
              <SurahCarousel
                data={SURAH_ITEMS}
                onSelect={handleSelectSurah}
                initialScrollIndex={carouselIndex}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      <View
        className="flex-1 items-center justify-center"
        onLayout={handleViewportLayout}
      >
        {isLandscape ? (
          <ScrollView
            style={{ flex: 1, alignSelf: "stretch" }}
            contentContainerStyle={{
              alignItems: "center",
              paddingHorizontal: horizontalPadding,
              paddingTop: topPadding,
              paddingBottom: bottomPadding,
            }}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={{
                width: pageSize.width,
                height: pageSize.height,
                alignSelf: "center",
              }}
            >
              {pageSize.width > 0 && pageSize.height > 0 ? (
                <QuranPager
                  data={PAGE_NUMBERS}
                  initialIndex={pageIndex}
                  onIndexChange={setPageIndex}
                  renderItem={renderPage}
                  scrollEnabled
                  pageWidth={pageSize.width}
                />
              ) : null}
            </View>
          </ScrollView>
        ) : (
          <View
            className="w-full items-center"
            style={{
              paddingHorizontal: horizontalPadding,
              paddingTop: topPadding,
              paddingBottom: bottomPadding,
            }}
          >
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
                <QuranPager
                  data={PAGE_NUMBERS}
                  initialIndex={pageIndex}
                  onIndexChange={setPageIndex}
                  renderItem={renderPage}
                  scrollEnabled
                  pageWidth={pageSize.width}
                  simultaneousGestures={[pinch, doubleTap]}
                />
              ) : null}
            </Animated.View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

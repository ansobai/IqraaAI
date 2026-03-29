// app/(surahs)/[surahId].tsx
import { useAuth } from "@clerk/clerk-expo";
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
  Alert,
  FlatList,
  Keyboard,
  LayoutChangeEvent,
  Modal,
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
import BookmarkModal from "../../components/BookmarkModal";
import QuoteLongPressOverlay from "../../components/QuoteLongPressOverlay";
import QuotePreviewModal from "../../components/QuotePreviewModal";
import SurahCarousel from "../../components/SurahCarousel";
import TasmeeOverlay from "../../components/TasmeeOverlay";
import { LAST_READ_PAGE_KEY } from "../../constants/storage";
import { useQuranRecitationPlayer } from "../../hooks/useQuranRecitationPlayer";
import { useTasmeeSession } from "../../hooks/useTasmeeSession";
import { ARABIC_SURAHS } from "../../constants/surahNames";
import { useQuranSearch } from "../../hooks/useQuranSearch";
import {
  MUSHAF_PAGES,
  MUSHAF_SURAH_START_PAGE,
  getSurahIdForPageNumber,
  type MushafPage,
} from "../../utils/mushafData";
import type { QuoteVerseSelection } from "../../utils/quoteVerseMapping";
import {
  loadQuranPageSvgXml,
  prefetchQuranPageSvgs,
} from "../../utils/quranSvgRegistry";
import { SearchResult } from "../../utils/searchUtils";
import { toArabicNumber } from "../../utils/toArabicNumbers";

// Load static data once
const PAGES = MUSHAF_PAGES as MushafPage[];
const SURAH_MAP = MUSHAF_SURAH_START_PAGE as Record<string, number>;
const PAGE_INDEX_BY_NUMBER = new Map<number, number>(
  PAGES.map((page, index) => [page.pageNumber, index]),
);
const getPageIndexByNumber = (pageNumber: number) =>
  PAGE_INDEX_BY_NUMBER.get(pageNumber) ?? -1;
const FALLBACK_PAGE_INDEX = Math.max(
  getPageIndexByNumber(1),
  0,
);
const FALLBACK_PAGE_NUMBER = PAGES[FALLBACK_PAGE_INDEX]?.pageNumber ?? 1;

const PAGE_NUMBERS = PAGES.map((page) => page.pageNumber);
const SURAH_ITEMS = ARABIC_SURAHS.map((name, id) => ({ id, name })).filter(
  (item) => item.id > 0,
);

const PAGE_ASPECT_RATIO = 729.448 / 510.236;
const PAGE_HORIZONTAL_PADDING = 2;
const PAGE_TOP_PADDING = 0;
const PAGE_BOTTOM_PADDING = 0;
const LANDSCAPE_HORIZONTAL_PADDING = 0;
const LANDSCAPE_TOP_PADDING = 0;
const LANDSCAPE_BOTTOM_PADDING = 0;
const NORMAL_SCALE = 1.36;
const FIRST_PAGES_SCALE = NORMAL_SCALE;
const MINI_SCALE = 0.85;
const MINI_LAYOUT_SHIFT_PX = 16;
const MINI_CAROUSEL_PAGE_GAP_PX = 14;
const MINI_TOP_PANEL_BASE_PADDING_PX = 40;
const MINI_TRIGGER_SCALE = 0.7;
const MINI_ANIMATION_DURATION_MS = 160;
const MIN_PINCH_SCALE = 0.5;
const MAX_PINCH_SCALE = 3;
const DOUBLE_TAP_WINDOW_MS = 180;
const DOUBLE_TAP_MAX_DISTANCE = 12;
const DOUBLE_TAP_MAX_DURATION = 120;
const PREFETCH_WINDOW = 3;
const MINI_BOTTOM_CONTROL_SIZE = 34;
const MINI_BOTTOM_ICON_SIZE = 22;
const MINI_BOTTOM_ICON_COLOR = "#000000";
const MUSHAF_PAGE_BACKGROUND = "#FFFAF2";
const MUSHAF_ACCENT = "#BFE3F2";
const MUSHAF_ACCENT_DARK = "#255A6D";
const MUSHAF_SURFACE = "#EAF6FC";
const MUSHAF_BORDER = "#C8E3EF";
const MUSHAF_BORDER_LIGHT = "#F6FCFF";
const MUSHAF_MUTED = "#5F7886";

const getNearbyPages = (pageNumber: number, windowSize: number) =>
  Array.from(
    { length: windowSize * 2 + 1 },
    (_, offset) => pageNumber - windowSize + offset,
  );

export default function SurahScreen() {
  const { isLoaded: isAuthLoaded, isSignedIn, signOut } = useAuth();
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
    const idx = getPageIndexByNumber(firstPageNumber);
    return idx === -1 ? 0 : idx;
  }, [firstPageNumber]);

  const [pageIndex, setPageIndex] = useState(initialIndex);
  const hasRestoredRef = useRef(false);
  const [isMini, setIsMini] = useState(false);
  const [isMiniMenuOpen, setIsMiniMenuOpen] = useState(false);
  const [isBookmarkModalOpen, setIsBookmarkModalOpen] = useState(false);
  const [quoteSelection, setQuoteSelection] =
    useState<QuoteVerseSelection | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const windowDimensions = useWindowDimensions();
  const isLandscape = windowDimensions.width > windowDimensions.height;
  const { query, setQuery, results, isSearching } = useQuranSearch();
  const trimmedQuery = query.trim();
  const hasSearchQuery = trimmedQuery.length > 0;

  const pinchScale = useSharedValue(1);
  const baseScaleValue = useSharedValue(NORMAL_SCALE);
  const miniModeValue = useSharedValue(0);
  const lastTapTimestamp = useSharedValue(0);
  const markerMaskProgress = useDerivedValue<number>(() =>
    withTiming(1, { duration: MINI_ANIMATION_DURATION_MS }),
  );

  const setMiniMode = useCallback((next: boolean) => {
    setIsMini(next);
  }, []);

  useEffect(() => {
    if (!isMini) setIsMiniMenuOpen(false);
  }, [isMini]);

  useEffect(() => {
    let isActive = true;

    const restoreLastPage = async () => {
      try {
        if (pageParam) {
          const targetPage = Number(pageParam);
          const targetIndex = getPageIndexByNumber(targetPage);
          if (targetIndex !== -1) {
            setPageIndex(targetIndex);
            return;
          }
        }

        if (forceFirstPage) {
          setPageIndex(initialIndex);
          return;
        }

        const saved = await AsyncStorage.getItem(LAST_READ_PAGE_KEY);
        if (!isActive) return;
        const savedNumber = saved ? Number(saved) : NaN;
        const savedIndex = Number.isFinite(savedNumber)
          ? getPageIndexByNumber(savedNumber)
          : -1;
        const savedSurahId = Number.isFinite(savedNumber)
          ? getSurahIdForPageNumber(savedNumber)
          : null;

        if (savedIndex >= 0 && savedSurahId === id) {
          setPageIndex(savedIndex);
        } else {
          setPageIndex(initialIndex);
        }
      } catch {
        if (isActive) {
          setPageIndex(initialIndex);
        }
      } finally {
        if (isActive) {
          hasRestoredRef.current = true;
        }
      }
    };

    restoreLastPage();

    return () => {
      isActive = false;
    };
  }, [forceFirstPage, id, initialIndex, pageParam]);

  useEffect(() => {
    const pageNumber = PAGES[pageIndex]?.pageNumber;
    if (!pageNumber) return;

    const nearbyPages = getNearbyPages(pageNumber, PREFETCH_WINDOW);
    const cancelPrefetch = prefetchQuranPageSvgs(nearbyPages);
    return cancelPrefetch;
  }, [pageIndex]);

  // Reset index if surahId or page param changes after initial restore
  useEffect(() => {
    if (!hasRestoredRef.current) return;

    if (pageParam) {
      const targetPage = Number(pageParam);
      const targetIndex = getPageIndexByNumber(targetPage);
      if (targetIndex !== -1) {
        setPageIndex(targetIndex);
        return;
      }
    }

    setPageIndex(initialIndex);
  }, [initialIndex, pageParam]);

  const page = PAGES[pageIndex] ?? PAGES[FALLBACK_PAGE_INDEX];
  const currentPageNumber = page?.pageNumber ?? FALLBACK_PAGE_NUMBER;
  const currentSurahId = useMemo(() => {
    const fallbackSurahId = getSurahIdForPageNumber(currentPageNumber);
    const pageSurahs = page?.surahs ?? [];

    if (!pageSurahs.length) return fallbackSurahId;

    let firstValidSurahId: number | null = null;
    let surahStartingOnPage: number | null = null;
    let fallbackFoundOnPage = false;

    for (const surah of pageSurahs) {
      const parsedSurahId = Number(surah.chapterNumber);
      if (!Number.isFinite(parsedSurahId) || parsedSurahId <= 0) continue;

      if (firstValidSurahId == null) {
        firstValidSurahId = parsedSurahId;
      }
      if (parsedSurahId === fallbackSurahId) {
        fallbackFoundOnPage = true;
      }

      const firstVerseNumber = Number(surah.text?.[0]?.verseNumber);
      if (surahStartingOnPage == null && firstVerseNumber === 1) {
        surahStartingOnPage = parsedSurahId;
      }
    }

    if (surahStartingOnPage != null) return surahStartingOnPage;
    if (fallbackFoundOnPage) return fallbackSurahId;
    return firstValidSurahId ?? fallbackSurahId;
  }, [currentPageNumber, page]);
  const tasmee = useTasmeeSession({
    pageNumber: currentPageNumber,
    surahId: id,
  });
  const {
    playVerse,
    playPageFromStart,
    stop: stopRecitation,
    state: recitationState,
  } = useQuranRecitationPlayer({
    onError: (message) => {
      Alert.alert("Recitation", message);
    },
  });
  const previousPageNumberRef = useRef(currentPageNumber);
  const isVerseAudioLoading =
    recitationState.mode === "verse" && recitationState.status === "loading";
  const isMiniPageAudioLoading =
    recitationState.mode === "page" && recitationState.status === "loading";
  const quoteFeatureEnabled = !isMini && !tasmee.isRunning;
  const quoteVerseSequence = useMemo<QuoteVerseSelection[]>(
    () =>
      PAGES.flatMap((pageItem) =>
        pageItem.surahs.flatMap((surah) => {
          const parsedSurahId = Number(surah.chapterNumber);
          const safeSurahId = Number.isFinite(parsedSurahId) ? parsedSurahId : 1;
          const surahName = surah.titleAr?.trim() || "";

          return surah.text.map((verse) => ({
            surahId: safeSurahId,
            surahName,
            verseNumber: String(verse.verseNumber ?? ""),
            verseText: verse.text ?? "",
            pageNumber: pageItem.pageNumber,
            lineNumber: 0,
          }));
        }),
      ),
    [],
  );
  const selectedQuoteIndex = useMemo(() => {
    if (!quoteSelection) return -1;

    const exactMatchIndex = quoteVerseSequence.findIndex(
      (verse) =>
        verse.surahId === quoteSelection.surahId &&
        verse.verseNumber === quoteSelection.verseNumber &&
        verse.pageNumber === quoteSelection.pageNumber,
    );
    if (exactMatchIndex !== -1) return exactMatchIndex;

    return quoteVerseSequence.findIndex(
      (verse) =>
        verse.surahId === quoteSelection.surahId &&
        verse.verseNumber === quoteSelection.verseNumber,
    );
  }, [quoteSelection, quoteVerseSequence]);
  const canGoToPreviousQuote = selectedQuoteIndex > 0;
  const canGoToNextQuote =
    selectedQuoteIndex !== -1 && selectedQuoteIndex < quoteVerseSequence.length - 1;

  useEffect(() => {
    if (!quoteFeatureEnabled) {
      setQuoteSelection(null);
    }
  }, [quoteFeatureEnabled]);

  useEffect(() => {
    const previousPageNumber = previousPageNumberRef.current;
    previousPageNumberRef.current = currentPageNumber;

    if (
      previousPageNumber !== currentPageNumber &&
      recitationState.mode === "page"
    ) {
      void stopRecitation();
    }
  }, [currentPageNumber, recitationState.mode, stopRecitation]);

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
    const miniScale = 1 + (MINI_SCALE - 1) * miniModeValue.value;
    const scale = baseScaleValue.value * miniScale * pinchScale.value;
    return {
      transform: [{ scale }],
    };
  });

  const gesturesEnabled = !isLandscape && !tasmee.isRunning;

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
        miniModeValue.value = withTiming(1, {
          duration: MINI_ANIMATION_DURATION_MS,
        });
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
        const next = miniModeValue.value <= 0.5;
        if (next) {
          miniModeValue.value = withTiming(1, {
            duration: MINI_ANIMATION_DURATION_MS,
          });
          runOnJS(setMiniMode)(true);
        } else {
          miniModeValue.value = withTiming(
            0,
            { duration: MINI_ANIMATION_DURATION_MS },
            (finished) => {
              if (finished) {
                runOnJS(setMiniMode)(false);
              }
            },
          );
        }
        pinchScale.value = 1;
        return;
      }

      lastTapTimestamp.value = now;
    });

  const handleQuoteDetected = useCallback((selection: QuoteVerseSelection) => {
    setQuoteSelection(selection);
  }, []);

  const handleCloseQuotePreview = useCallback(() => {
    setQuoteSelection(null);
  }, []);
  const handlePreviousQuote = useCallback(() => {
    if (!canGoToPreviousQuote) return;
    setQuoteSelection(quoteVerseSequence[selectedQuoteIndex - 1] ?? null);
  }, [canGoToPreviousQuote, quoteVerseSequence, selectedQuoteIndex]);
  const handleNextQuote = useCallback(() => {
    if (!canGoToNextQuote) return;
    setQuoteSelection(quoteVerseSequence[selectedQuoteIndex + 1] ?? null);
  }, [canGoToNextQuote, quoteVerseSequence, selectedQuoteIndex]);
  const handlePlayQuoteVerse = useCallback(
    (selection: QuoteVerseSelection) => {
      void playVerse({
        surahId: selection.surahId,
        verseNumber: selection.verseNumber,
      });
    },
    [playVerse],
  );

  const renderPage = useCallback(
    ({ item, index }: { item: number; index: number }) => {
      const isActivePage = index === pageIndex;
      return (
        <View style={{ flex: 1 }}>
          <QuranPage
            pageNumber={item}
            markerMaskProgress={markerMaskProgress}
            pageWidth={pageSize.width}
          />
          {isActivePage && quoteFeatureEnabled ? (
            <QuoteLongPressOverlay
              pageNumber={item}
              pageWidth={pageSize.width}
              pageHeight={pageSize.height}
              enabled={quoteFeatureEnabled}
              onQuoteDetected={handleQuoteDetected}
            />
          ) : null}
        </View>
      );
    },
    [
      handleQuoteDetected,
      markerMaskProgress,
      pageIndex,
      pageSize.height,
      pageSize.width,
      quoteFeatureEnabled,
    ],
  );

  const getFirstPageIndexForSurah = useCallback((surahNumber: number) => {
    const firstPage = SURAH_MAP[String(surahNumber)] ?? FALLBACK_PAGE_NUMBER;
    const idx = getPageIndexByNumber(firstPage);
    return idx === -1 ? FALLBACK_PAGE_INDEX : idx;
  }, []);

  const prefetchTargetPages = useCallback((pageNumber: number) => {
    if (!pageNumber) return;
    void loadQuranPageSvgXml(pageNumber);
    void prefetchQuranPageSvgs(getNearbyPages(pageNumber, PREFETCH_WINDOW));
  }, []);

  const handleSelectSurah = useCallback(
    (surahNumber: number) => {
      if (tasmee.isRunning) {
        void tasmee.stopSession();
      }
      const targetIndex = getFirstPageIndexForSurah(surahNumber);
      const targetPageNumber =
        PAGES[targetIndex]?.pageNumber ?? FALLBACK_PAGE_NUMBER;
      prefetchTargetPages(targetPageNumber);
      setPageIndex(targetIndex);

      const shouldReplaceRoute =
        surahNumber !== id || Boolean(pageParam) || !forceFirstPage;

      if (shouldReplaceRoute) {
        router.replace({
          pathname: "/[surahId]",
          params: {
            surahId: String(surahNumber),
            startAt: "first",
          },
        });
      }
    },
    [
      forceFirstPage,
      getFirstPageIndexForSurah,
      id,
      pageParam,
      prefetchTargetPages,
      router,
      tasmee,
    ],
  );

  const handleSearchResultPress = useCallback(
    (result: SearchResult) => {
      if (tasmee.isRunning) {
        void tasmee.stopSession();
      }
      setQuery("");
      Keyboard.dismiss();

      if (result.type === "surah") {
        handleSelectSurah(result.id);
      } else {
        const targetIndex = getPageIndexByNumber(result.pageNumber);
        prefetchTargetPages(result.pageNumber);
        if (targetIndex !== -1) {
          setPageIndex(targetIndex);
        }
        router.replace({
          pathname: "/[surahId]",
          params: {
            surahId: String(result.surahId),
            page: String(result.pageNumber),
          },
        });
      }

      if (isMini) {
        miniModeValue.value = withTiming(0, {
          duration: MINI_ANIMATION_DURATION_MS,
        });
        setIsMini(false);
      }
    },
    [
      handleSelectSurah,
      isMini,
      miniModeValue,
      prefetchTargetPages,
      router,
      setQuery,
      tasmee,
    ],
  );

  const carouselIndex = Math.max(
    0,
    Math.min(SURAH_ITEMS.length - 1, currentSurahId - 1),
  );
  const handleOpenBookmarkModal = useCallback(() => {
    setIsBookmarkModalOpen(true);
  }, []);
  const handleCloseBookmarkModal = useCallback(() => {
    setIsBookmarkModalOpen(false);
  }, []);
  const horizontalPadding = isLandscape
    ? LANDSCAPE_HORIZONTAL_PADDING
    : PAGE_HORIZONTAL_PADDING;
  const topPadding = isLandscape ? LANDSCAPE_TOP_PADDING : PAGE_TOP_PADDING;
  const bottomPadding = isLandscape
    ? LANDSCAPE_BOTTOM_PADDING
    : PAGE_BOTTOM_PADDING;

  const pageContent = (
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
          scrollEnabled={!tasmee.isRunning}
          pageWidth={pageSize.width}
          simultaneousGestures={[pinch, doubleTap]}
        />
      ) : null}
      <TasmeeOverlay
        pageData={tasmee.pageData}
        wordStates={tasmee.wordStates}
        isLocked={tasmee.isLocked}
        pageNumber={currentPageNumber}
        pageWidth={pageSize.width}
        pageHeight={pageSize.height}
      />
      {tasmee.isListeningForStart ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 14,
            left: 0,
            right: 0,
            alignItems: "center",
          }}
        >
          <View
            style={{
              backgroundColor: "rgba(226, 242, 250, 0.98)",
              borderWidth: 1,
              borderColor: "#9BC4D6",
              borderRadius: 999,
              paddingHorizontal: 14,
              paddingVertical: 7,
            }}
          >
            <Text
              style={{
                color: "#143441",
                fontSize: 12,
                fontWeight: "600",
              }}
            >
              Listening for your starting words...
            </Text>
          </View>
        </View>
      ) : null}
      {tasmee.status === "error" && tasmee.errorMessage ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 14,
            left: 0,
            right: 0,
            alignItems: "center",
            paddingHorizontal: 14,
          }}
        >
          <View
            style={{
              backgroundColor: "rgba(245, 225, 225, 0.98)",
              borderWidth: 1,
              borderColor: "#C56C6C",
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 8,
              maxWidth: "96%",
            }}
          >
            <Text
              style={{
                color: "#7F2929",
                fontSize: 12,
                fontWeight: "600",
                textAlign: "center",
              }}
            >
              {tasmee.errorMessage}
            </Text>
          </View>
        </View>
      ) : null}
    </Animated.View>
  );

  return (
    <SafeAreaView
      className="flex-1"
      style={{ backgroundColor: MUSHAF_PAGE_BACKGROUND }}
      edges={["top", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <Modal
        visible={isMiniMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsMiniMenuOpen(false)}
      >
        <View className="flex-1">
          <Pressable
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            onPress={() => setIsMiniMenuOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          >
            <View className="flex-1 bg-black/40" />
          </Pressable>

          <View
            className="flex-1 items-end pt-16 px-5"
            pointerEvents="box-none"
          >
            <View className="w-64 rounded-2xl bg-[#FFFDF5] border border-[#E8E1D1] overflow-hidden">
              <Pressable
                onPress={() => {
                  setIsMiniMenuOpen(false);
                  router.push("/(profile)/profile");
                }}
                className="px-4 py-4 flex-row-reverse items-center gap-3 active:bg-[#F9F9F9]"
                accessibilityRole="button"
                accessibilityLabel="My profile"
              >
                <Ionicons name="person-outline" size={18} color="#2E8B57" />
                <Text className="text-lg text-[#1F1F1F] font-semibold">
                  Profile
                </Text>
              </Pressable>

              <View className="h-px bg-[#E8E1D1]" />

              {isAuthLoaded && isSignedIn ? (
                <Pressable
                  onPress={() => {
                    setIsMiniMenuOpen(false);
                    void signOut();
                  }}
                  className="px-4 py-4 flex-row-reverse items-center gap-3 active:bg-[#F9F9F9]"
                  accessibilityRole="button"
                  accessibilityLabel="Logout"
                >
                  <Ionicons name="log-out-outline" size={18} color="#2E8B57" />
                  <Text className="text-lg text-[#1F1F1F] font-semibold">
                    Logout
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => {
                    setIsMiniMenuOpen(false);
                    router.push("/(auth)/sign-in");
                  }}
                  className="px-4 py-4 flex-row-reverse items-center gap-3 active:bg-[#F9F9F9]"
                  accessibilityRole="button"
                  accessibilityLabel="Sign in or sign up"
                >
                  <Ionicons name="log-in-outline" size={18} color="#2E8B57" />
                  <Text className="text-lg text-[#1F1F1F] font-semibold">
                    Sign In / Sign Up
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {isMini ? (
        <View
          className="pb-1"
          pointerEvents="box-none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            paddingTop:
              MINI_TOP_PANEL_BASE_PADDING_PX + MINI_LAYOUT_SHIFT_PX,
            zIndex: 5,
          }}
        >
          <View className="px-4 mb-2">
            <View
              className="rounded-[26px] px-4 py-3"
              style={{
                backgroundColor: "#F4FAFE",
                borderColor: MUSHAF_BORDER,
                borderWidth: 1,
                shadowColor: "#3B697A",
                shadowOpacity: 0.12,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
                elevation: 3,
              }}
            >
              <View className="flex-row-reverse items-center gap-2">
                <View
                  className="w-8 h-8 rounded-full items-center justify-center"
                  style={{ backgroundColor: "#DDEFF8" }}
                >
                  <Ionicons name="search" size={17} color={MUSHAF_ACCENT_DARK} />
                </View>
                <TextInput
                  placeholder="ابحث في السور والآيات..."
                  placeholderTextColor={MUSHAF_MUTED}
                  className="flex-1 text-right text-[20px] text-[#1E2C35] font-uthmanic"
                  value={query}
                  onChangeText={setQuery}
                />
                {hasSearchQuery ? (
                  <Pressable
                    onPress={() => setQuery("")}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    className="w-8 h-8 rounded-full items-center justify-center"
                    style={{ backgroundColor: "#E6F3FA" }}
                  >
                    <Ionicons name="close" size={16} color={MUSHAF_MUTED} />
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>

          {hasSearchQuery ? (
            <View
              className="mx-4 mb-2 rounded-[28px] overflow-hidden"
              style={{
                maxHeight: windowDimensions.height * 0.58,
                backgroundColor: "#FFFFFF",
                borderColor: MUSHAF_BORDER,
                borderWidth: 1,
                shadowColor: "#3B697A",
                shadowOpacity: 0.16,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 8 },
                elevation: 4,
              }}
            >
              <View
                className="px-4 py-2 flex-row-reverse items-center justify-between"
                style={{
                  backgroundColor: "#F1F9FD",
                  borderBottomColor: "#DDEEF6",
                  borderBottomWidth: 1,
                }}
              >
                <Text className="text-lg text-[#2B6072] font-uthmanic font-bold">
                  النتائج
                </Text>
                {isSearching ? (
                  <ActivityIndicator size="small" color={MUSHAF_ACCENT_DARK} />
                ) : (
                  <Text className="text-base text-[#5F7886] font-uthmanic">
                    {toArabicNumber(results.length)}
                  </Text>
                )}
              </View>

              {isSearching ? (
                <View className="py-8 items-center justify-center">
                  <ActivityIndicator color={MUSHAF_ACCENT_DARK} />
                </View>
              ) : results.length === 0 ? (
                <View className="py-8 items-center justify-center px-5">
                  <Text className="text-[#2E434F] font-uthmanic text-2xl">
                    لا توجد نتائج
                  </Text>
                  <Text className="text-[#6F8997] font-uthmanic text-lg mt-1">
                    جرّب كتابة كلمة أطول أو أوضح
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={results}
                  keyExtractor={(item) =>
                    item.type === "surah"
                      ? `surah-${item.id}`
                      : `verse-${item.surahId}-${item.verseNumber}-${item.pageNumber}`
                  }
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ padding: 10, paddingBottom: 12 }}
                  renderItem={({ item, index }) => {
                    const isLastRow = index === results.length - 1;
                    const rowBackground =
                      item.type === "surah" ? "#EEF8FC" : "#F8FCFE";

                    return (
                      <Pressable
                        onPress={() => handleSearchResultPress(item)}
                        style={({ pressed }) => ({
                          backgroundColor: pressed ? "#E6F3FA" : rowBackground,
                          borderColor: "#D7EAF3",
                          borderWidth: 1,
                          borderRadius: 18,
                          paddingHorizontal: 12,
                          paddingVertical: item.type === "verse" ? 12 : 10,
                          marginBottom: isLastRow ? 0 : 8,
                        })}
                      >
                        <View className="flex-row items-start gap-3">
                          <View
                            className="w-7 h-7 rounded-full items-center justify-center mt-1"
                            style={{ backgroundColor: "#E0F1F8" }}
                          >
                            <Ionicons
                              name="chevron-back"
                              size={14}
                              color="#83A7B8"
                            />
                          </View>

                          {item.type === "surah" ? (
                            <View className="flex-1 min-w-0">
                              <View className="flex-row-reverse items-center gap-3">
                                <View
                                  className="w-8 h-8 rounded-full items-center justify-center"
                                  style={{ backgroundColor: "#D4EAF5" }}
                                >
                                  <Text className="text-[#385666] font-bold text-base">
                                    {toArabicNumber(item.id)}
                                  </Text>
                                </View>
                                <Text
                                  className="text-[28px] text-[#1F2C34] font-uthmanic font-bold text-right flex-1"
                                  numberOfLines={1}
                                  style={{ writingDirection: "rtl" }}
                                >
                                  سورة {item.name}
                                </Text>
                              </View>
                              <Text
                                className="text-sm text-[#5D7A88] font-uthmanic mt-1 text-right"
                                style={{ writingDirection: "rtl" }}
                              >
                                انتقال مباشر إلى السورة
                              </Text>
                            </View>
                          ) : (
                            <View className="flex-1 min-w-0">
                              <View className="flex-row-reverse items-center gap-2 mb-1">
                                <Text
                                  className="text-2xl text-[#255A6D] font-bold font-uthmanic"
                                  numberOfLines={1}
                                  style={{ writingDirection: "rtl", flex: 1 }}
                                >
                                  سورة {item.surahName}
                                </Text>
                                <View
                                  className="px-2 py-0.5 rounded-full"
                                  style={{ backgroundColor: "#E1F2F9" }}
                                >
                                  <Text className="text-lg text-[#4F6F7E] font-uthmanic">
                                    {toArabicNumber(Number(item.verseNumber))}
                                  </Text>
                                </View>
                              </View>

                              <Text
                                className="text-[30px] text-[#1F1F1F] font-uthmanic text-right"
                                numberOfLines={2}
                                ellipsizeMode="tail"
                                style={{
                                  writingDirection: "rtl",
                                  lineHeight: 44,
                                  paddingRight: 2,
                                  paddingLeft: 6,
                                }}
                              >
                                {item.text}
                              </Text>
                            </View>
                          )}
                        </View>
                      </Pressable>
                    );
                  }}
                />
              )}
            </View>
          ) : null}

          {!hasSearchQuery ? (
            <View className="h-20 mt-1 mb-4">
              <SurahCarousel
                data={SURAH_ITEMS}
                onSelect={handleSelectSurah}
                initialScrollIndex={carouselIndex}
                autoSelectOnMount={false}
                tapSelectMode="immediate"
                swipeDwellMs={2000}
                variant="miniUnderline"
              />
            </View>
          ) : null}

          <View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
            }}
          >
            <View
              className="mx-6 mb-3 rounded-t-3xl px-10 py-3"
              style={{
                backgroundColor: MUSHAF_SURFACE,
                borderColor: MUSHAF_BORDER,
                borderWidth: 1,
                shadowColor: "#000",
                shadowOpacity: 0.08,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
                elevation: 4,
              }}
            >
              <View className="flex-row items-center justify-center gap-10">
                <Pressable
                  onPress={handleOpenBookmarkModal}
                  accessibilityRole="button"
                  accessibilityLabel="Open bookmarks"
                  style={({ pressed }) => ({
                    width: MINI_BOTTOM_CONTROL_SIZE,
                    height: MINI_BOTTOM_CONTROL_SIZE,
                    borderRadius: MINI_BOTTOM_CONTROL_SIZE / 2,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <Ionicons
                    name="bookmark-outline"
                    size={MINI_BOTTOM_ICON_SIZE}
                    color={MINI_BOTTOM_ICON_COLOR}
                  />
                </Pressable>
                <View
                  style={{
                    width: MINI_BOTTOM_CONTROL_SIZE,
                    height: MINI_BOTTOM_CONTROL_SIZE,
                    borderRadius: MINI_BOTTOM_CONTROL_SIZE / 2,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name="moon-outline"
                    size={MINI_BOTTOM_ICON_SIZE}
                    color={MINI_BOTTOM_ICON_COLOR}
                  />
                </View>
                <Pressable
                  onPress={() => void playPageFromStart(page)}
                  accessibilityRole="button"
                  accessibilityLabel="Play current page recitation"
                  style={({ pressed }) => ({
                    width: MINI_BOTTOM_CONTROL_SIZE,
                    height: MINI_BOTTOM_CONTROL_SIZE,
                    borderRadius: MINI_BOTTOM_CONTROL_SIZE / 2,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "transparent",
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <Ionicons
                    name={isMiniPageAudioLoading ? "download" : "play"}
                    size={MINI_BOTTOM_ICON_SIZE}
                    color={MINI_BOTTOM_ICON_COLOR}
                  />
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (tasmee.isRunning) {
                      void tasmee.stopSession();
                      return;
                    }
                    void stopRecitation();
                    void tasmee.startSession();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    tasmee.isRunning ? "Stop tasmee" : "Start tasmee"
                  }
                  style={({ pressed }) => ({
                    width: MINI_BOTTOM_CONTROL_SIZE,
                    height: MINI_BOTTOM_CONTROL_SIZE,
                    borderRadius: MINI_BOTTOM_CONTROL_SIZE / 2,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "transparent",
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <Ionicons
                    name="mic"
                    size={MINI_BOTTOM_ICON_SIZE}
                    color={MINI_BOTTOM_ICON_COLOR}
                  />
                </Pressable>
              </View>
            </View>
          </View>
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
                  scrollEnabled={!tasmee.isRunning}
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
            <View
              style={[
                isMini && {
                  padding: 10,
                  transform: [
                    {
                      translateY:
                        MINI_LAYOUT_SHIFT_PX + MINI_CAROUSEL_PAGE_GAP_PX,
                    },
                  ],
                  backgroundColor: MUSHAF_ACCENT,
                  borderRadius: 20,
                  borderWidth: 2,
                  borderColor: MUSHAF_BORDER_LIGHT,
                  shadowColor: "#4C7F95",
                  shadowOpacity: 0.22,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 7 },
                  elevation: 4,
                },
              ]}
            >
              {pageContent}
            </View>
          </View>
        )}
      </View>
      <BookmarkModal
        visible={isBookmarkModalOpen}
        onClose={handleCloseBookmarkModal}
        currentPageNumber={page?.pageNumber}
      />
      <QuotePreviewModal
        visible={quoteSelection != null}
        quote={quoteSelection}
        onClose={handleCloseQuotePreview}
        onPlayVerse={handlePlayQuoteVerse}
        isVerseAudioLoading={isVerseAudioLoading}
        onPreviousVerse={handlePreviousQuote}
        onNextVerse={handleNextQuote}
        canGoPreviousVerse={canGoToPreviousQuote}
        canGoNextVerse={canGoToNextQuote}
      />
    </SafeAreaView>
  );
}

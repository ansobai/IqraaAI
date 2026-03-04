import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  type LayoutChangeEvent,
  Modal,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  type TextLayoutEventData,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from "react-native";

import { buildSavedQuoteId, useSavedQuotes } from "../hooks/useSavedQuotes";
import { fetchMuyassarTafsir } from "../utils/tafsirApi";
import { toArabicNumber } from "../utils/toArabicNumbers";
import { type QuoteVerseSelection } from "../utils/quoteVerseMapping";

type QuoteActionPayload = {
  quote: QuoteVerseSelection;
  tafsirText: string;
};

type QuotePreviewModalProps = {
  visible: boolean;
  quote: QuoteVerseSelection | null;
  onClose: () => void;
  onPlayVerse: (quote: QuoteVerseSelection) => void;
  isVerseAudioLoading: boolean;
  onPreviousVerse?: () => void;
  onNextVerse?: () => void;
  canGoPreviousVerse?: boolean;
  canGoNextVerse?: boolean;
  onBookmarkQuote?: (quote: QuoteVerseSelection) => void | Promise<void>;
  onShareQuote?: (payload: QuoteActionPayload) => void | Promise<void>;
  onDownloadQuote?: (payload: QuoteActionPayload) => void | Promise<void>;
  onToggleTafsirFocus?: (
    focused: boolean,
    quote: QuoteVerseSelection,
  ) => void;
};

const SURAH_PREFIX = "سورة";
const AYAH_LABEL = "الآية";
const TAFSIR_LABEL = "التفسير الميسر";
const TAFSIR_FALLBACK_TEXT = "تعذر تحميل التفسير الميسر حالياً.";
const TAFSIR_LOADING_TEXT = "جاري تحميل التفسير الميسر...";
const DOWNLOAD_FILE_PREFIX = "iqraaai-quote";
const AYAH_END_MARKER = "\u06DD";
const WAQF_MARKER_SPLIT_REGEX = /([\uFBBF\u06DF])/u;
const WAQF_MARKER_TOKEN_REGEX = /^[\uFBBF\u06DF]$/u;
const TRAILING_AYAH_DECORATION_REGEX =
  /(?:[\u200E\u200F\u061C\s]*[\u06DD\u06DE\u06E9]\s*[0-9\u0660-\u0669\u06F0-\u06F9]*[\u200E\u200F\u061C\s]*)+$/u;
const MIN_VERSE_FONT_SIZE = 24;
const MIN_TAFSIR_FONT_SIZE = 14;
const MAX_TAFSIR_FONT_SIZE = 20;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const stripTrailingAyahMarker = (verseText: string) =>
  verseText.replace(TRAILING_AYAH_DECORATION_REGEX, "").trimEnd();

const normalizeVerseTextForDisplay = (verseText: string) =>
  verseText.normalize("NFC");

const getInitialVerseFontSize = (
  verseLength: number,
  maxVerseFontSize: number,
) => {
  const scaled =
    verseLength > 290
      ? maxVerseFontSize - 14
      : verseLength > 240
        ? maxVerseFontSize - 12
        : verseLength > 200
          ? maxVerseFontSize - 10
          : verseLength > 160
            ? maxVerseFontSize - 8
            : verseLength > 125
              ? maxVerseFontSize - 5
              : verseLength > 95
                ? maxVerseFontSize - 3
                : maxVerseFontSize;

  return clamp(Math.round(scaled), MIN_VERSE_FONT_SIZE, maxVerseFontSize);
};

const getInitialTafsirFontSize = (tafsirLength: number, isCompactHeight: boolean) => {
  const baseSize = isCompactHeight ? 18 : 20;
  const scaled =
    tafsirLength > 780
      ? baseSize - 6
      : tafsirLength > 620
        ? baseSize - 5
        : tafsirLength > 460
          ? baseSize - 4
          : tafsirLength > 320
            ? baseSize - 3
            : tafsirLength > 220
              ? baseSize - 2
              : tafsirLength > 120
                ? baseSize - 1
                : baseSize;

  return clamp(Math.round(scaled), MIN_TAFSIR_FONT_SIZE, MAX_TAFSIR_FONT_SIZE);
};

const formatQuoteText = ({
  quote,
  verseNumberLabel,
  cleanVerseText,
  tafsirText,
}: {
  quote: QuoteVerseSelection;
  verseNumberLabel: string;
  cleanVerseText: string;
  tafsirText: string;
}) => {
  const ayahLine = `${cleanVerseText} ${AYAH_END_MARKER}${verseNumberLabel}`.trim();
  const metadataLine = `${SURAH_PREFIX} ${quote.surahName} - ${AYAH_LABEL} ${verseNumberLabel}`;
  const tafsirBlock = tafsirText.trim()
    ? `\n\n${TAFSIR_LABEL}\n${tafsirText.trim()}`
    : "";

  return `${metadataLine}\n\n${ayahLine}${tafsirBlock}`;
};

type DockActionButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  isPrimary?: boolean;
  isActive?: boolean;
  isDisabled?: boolean;
  size: number;
  iconSize: number;
  horizontalMargin: number;
};

function DockActionButton({
  icon,
  onPress,
  accessibilityLabel,
  isPrimary = false,
  isActive = false,
  isDisabled = false,
  size,
  iconSize,
  horizontalMargin,
}: DockActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.dockActionPressable,
        { marginHorizontal: horizontalMargin },
        isDisabled && styles.dockActionDisabled,
        pressed && !isDisabled && styles.dockActionPressed,
      ]}
    >
      <View
        style={[
          styles.dockActionCircle,
          { width: size, height: size, borderRadius: size / 2 },
          isPrimary && styles.dockActionCirclePrimary,
          !isPrimary && styles.dockActionCircleSecondary,
          isActive && styles.dockActionCircleActive,
          isDisabled && styles.dockActionCircleDisabled,
        ]}
      >
        <Ionicons
          name={icon}
          size={iconSize}
          color={
            isDisabled
              ? "#A8BDC2"
              : isPrimary
                ? "#FFFFFF"
                : isActive
                  ? "#1F6F7A"
                  : "#6FB5C0"
          }
        />
      </View>
    </Pressable>
  );
}

export default function QuotePreviewModal({
  visible,
  quote,
  onClose,
  onPlayVerse,
  isVerseAudioLoading,
  onPreviousVerse,
  onNextVerse,
  canGoPreviousVerse = false,
  canGoNextVerse = false,
  onBookmarkQuote,
  onShareQuote,
  onDownloadQuote,
  onToggleTafsirFocus,
}: QuotePreviewModalProps) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const isCompactHeight = windowHeight < 760;
  const isVisible = visible && quote != null;
  const showVerseNavigation = Boolean(onPreviousVerse || onNextVerse);
  const [isTafsirFocused, setIsTafsirFocused] = useState(false);

  const { isSavedQuote, toggleSavedQuote } = useSavedQuotes();

  const headerLabel = quote ? `${SURAH_PREFIX} ${quote.surahName}` : SURAH_PREFIX;
  const numericVerse = Number(quote?.verseNumber);
  const verseNumberLabel = Number.isFinite(numericVerse)
    ? toArabicNumber(numericVerse)
    : quote?.verseNumber ?? "";

  const cleanVerseText = stripTrailingAyahMarker(quote?.verseText ?? "");
  const verseDisplayText = normalizeVerseTextForDisplay(cleanVerseText);
  const verseDisplayParts = verseDisplayText
    .split(WAQF_MARKER_SPLIT_REGEX)
    .filter((part) => part.length > 0);

  const verseCharacterCount = cleanVerseText.length;
  const maxVerseFontSize = isCompactHeight ? 42 : 48;
  const maxVerseLines = isCompactHeight ? 6 : 7;
  const initialVerseFontSize = useMemo(
    () => getInitialVerseFontSize(verseCharacterCount, maxVerseFontSize),
    [maxVerseFontSize, verseCharacterCount],
  );
  const [currentVerseFontSize, setCurrentVerseFontSize] =
    useState(initialVerseFontSize);
  const [verseViewportHeight, setVerseViewportHeight] = useState(0);
  const [verseContentHeight, setVerseContentHeight] = useState(0);

  const [tafsirText, setTafsirText] = useState("");
  const [isTafsirLoading, setIsTafsirLoading] = useState(false);
  const [tafsirError, setTafsirError] = useState<string | null>(null);
  const [tafsirViewportHeight, setTafsirViewportHeight] = useState(0);
  const [tafsirContentHeight, setTafsirContentHeight] = useState(0);

  const effectiveTafsirText = isTafsirLoading
    ? TAFSIR_LOADING_TEXT
    : tafsirError
      ? tafsirError
      : tafsirText;
  const shareableTafsirText =
    !isTafsirLoading && !tafsirError ? tafsirText.trim() : "";
  const initialTafsirFontSize = useMemo(
    () => getInitialTafsirFontSize(effectiveTafsirText.length, isCompactHeight),
    [effectiveTafsirText.length, isCompactHeight],
  );
  const [currentTafsirFontSize, setCurrentTafsirFontSize] =
    useState(initialTafsirFontSize);
  const maxTafsirLines = isTafsirFocused
    ? isCompactHeight
      ? 11
      : 13
    : isCompactHeight
      ? 7
      : 9;

  const quoteId = useMemo(() => {
    if (!quote) return "";
    return buildSavedQuoteId(quote.surahId, quote.verseNumber, quote.pageNumber);
  }, [quote]);
  const isQuoteBookmarked = quoteId ? isSavedQuote(quoteId) : false;

  const cardWidth = Math.min(windowWidth - 34, 620);
  const cardMaxHeight = Math.min(windowHeight * 0.94, 940);
  const layoutContentHeight = clamp(
    cardMaxHeight - (isCompactHeight ? 286 : 322),
    320,
    isCompactHeight ? 490 : 620,
  );
  const tafsirRatio = isTafsirFocused ? 0.5 : 0.36;
  const tafsirSectionHeight = clamp(
    layoutContentHeight * tafsirRatio,
    isCompactHeight ? 138 : 160,
    isCompactHeight ? 280 : 340,
  );
  const verseSectionHeight = clamp(
    layoutContentHeight - tafsirSectionHeight - (isCompactHeight ? 36 : 44),
    150,
    isCompactHeight ? 320 : 420,
  );
  const isNarrowCard = cardWidth < 390;
  const baseNavButtonSize = isNarrowCard ? 38 : 42;
  const baseRegularButtonSize = isNarrowCard ? 45 : 52;
  const basePlayButtonSize = isNarrowCard ? 62 : 72;
  const baseSpacing = isNarrowCard ? 8 : 10;
  const controlsCount = showVerseNavigation ? 7 : 5;
  const baseButtonsWidth =
    (showVerseNavigation ? baseNavButtonSize * 2 : 0) +
    baseRegularButtonSize * 4 +
    basePlayButtonSize;
  const estimatedDockWidth = baseButtonsWidth + baseSpacing * (controlsCount - 1);
  const controlsAvailableWidth = cardWidth - 48;
  const controlsScale = Math.min(1, controlsAvailableWidth / estimatedDockWidth);
  const navButtonSize = Math.max(28, Math.round(baseNavButtonSize * controlsScale));
  const navIconSize = Math.max(
    16,
    Math.round((isNarrowCard ? 18 : 20) * controlsScale),
  );
  const regularButtonSize = Math.max(
    34,
    Math.round(baseRegularButtonSize * controlsScale),
  );
  const regularIconSize = Math.max(
    18,
    Math.round((isNarrowCard ? 20 : 22) * controlsScale),
  );
  const playButtonSize = Math.max(50, Math.round(basePlayButtonSize * controlsScale));
  const playIconSize = Math.max(
    24,
    Math.round((isNarrowCard ? 28 : 32) * controlsScale),
  );
  const dockActionHorizontalMargin = showVerseNavigation
    ? 1
    : Math.max(1, Math.round((baseSpacing / 2) * controlsScale));

  const verseLineHeight = Math.round(
    currentVerseFontSize *
      Platform.select({
        ios: 1.7,
        android: 1.64,
        default: 1.68,
      }),
  );
  const tafsirLineHeight = Math.round(
    currentTafsirFontSize *
      Platform.select({
        ios: 1.78,
        android: 1.72,
        default: 1.76,
      }),
  );

  const sharePayload = useMemo<QuoteActionPayload | null>(() => {
    if (!quote) return null;
    return {
      quote,
      tafsirText: shareableTafsirText,
    };
  }, [quote, shareableTafsirText]);

  const quoteExportText = useMemo(() => {
    if (!quote) return "";
    return formatQuoteText({
      quote,
      verseNumberLabel,
      cleanVerseText,
      tafsirText: shareableTafsirText,
    });
  }, [cleanVerseText, quote, shareableTafsirText, verseNumberLabel]);

  useEffect(() => {
    setCurrentVerseFontSize(initialVerseFontSize);
    setVerseViewportHeight(0);
    setVerseContentHeight(0);
  }, [
    initialVerseFontSize,
    quote?.surahId,
    quote?.verseNumber,
    quote?.pageNumber,
    quote?.verseText,
  ]);

  useEffect(() => {
    setCurrentTafsirFontSize(initialTafsirFontSize);
    setTafsirViewportHeight(0);
    setTafsirContentHeight(0);
  }, [
    initialTafsirFontSize,
    quote?.surahId,
    quote?.verseNumber,
    quote?.pageNumber,
    effectiveTafsirText,
    isTafsirFocused,
  ]);

  useEffect(() => {
    setIsTafsirFocused(false);
  }, [quote?.surahId, quote?.verseNumber, quote?.pageNumber, isVisible]);

  useEffect(() => {
    if (!quote || !isVisible) {
      setTafsirText("");
      setTafsirError(null);
      setIsTafsirLoading(false);
      return;
    }

    const abortController = new AbortController();
    setIsTafsirLoading(true);
    setTafsirError(null);

    void fetchMuyassarTafsir({
      surahId: quote.surahId,
      verseNumber: quote.verseNumber,
      signal: abortController.signal,
    })
      .then((text) => {
        setTafsirText(text.trim());
      })
      .catch((error: unknown) => {
        const aborted = error instanceof Error && error.name === "AbortError";
        if (aborted) return;
        setTafsirText("");
        setTafsirError(TAFSIR_FALLBACK_TEXT);
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsTafsirLoading(false);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [isVisible, quote]);

  const handleVerseTextLayout = useCallback(
    (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      const lineCount = event.nativeEvent.lines.length;
      if (!lineCount) return;

      setCurrentVerseFontSize((previousSize) => {
        if (lineCount > maxVerseLines && previousSize > MIN_VERSE_FONT_SIZE) {
          return previousSize - 1;
        }
        if (lineCount <= maxVerseLines - 2 && previousSize < initialVerseFontSize) {
          return previousSize + 1;
        }
        return previousSize;
      });
    },
    [initialVerseFontSize, maxVerseLines],
  );

  const handleTafsirTextLayout = useCallback(
    (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      const lineCount = event.nativeEvent.lines.length;
      if (!lineCount) return;

      setCurrentTafsirFontSize((previousSize) => {
        if (lineCount > maxTafsirLines && previousSize > MIN_TAFSIR_FONT_SIZE) {
          return previousSize - 1;
        }
        if (lineCount <= maxTafsirLines - 2 && previousSize < initialTafsirFontSize) {
          return previousSize + 1;
        }
        return previousSize;
      });
    },
    [initialTafsirFontSize, maxTafsirLines],
  );

  const handleVerseViewportLayout = useCallback((event: LayoutChangeEvent) => {
    setVerseViewportHeight(event.nativeEvent.layout.height);
  }, []);

  const handleTafsirViewportLayout = useCallback((event: LayoutChangeEvent) => {
    setTafsirViewportHeight(event.nativeEvent.layout.height);
  }, []);

  const handleVerseContentSizeChange = useCallback(
    (_width: number, height: number) => {
      setVerseContentHeight(height);
    },
    [],
  );

  const handleTafsirContentSizeChange = useCallback(
    (_width: number, height: number) => {
      setTafsirContentHeight(height);
    },
    [],
  );

  const isVerseOverflowing = useMemo(
    () => verseContentHeight - verseViewportHeight > 2,
    [verseContentHeight, verseViewportHeight],
  );
  const isTafsirOverflowing = useMemo(
    () => tafsirContentHeight - tafsirViewportHeight > 2,
    [tafsirContentHeight, tafsirViewportHeight],
  );

  const handleBookmarkPress = useCallback(async () => {
    if (!quote) return;

    try {
      if (onBookmarkQuote) {
        await onBookmarkQuote(quote);
        return;
      }

      await toggleSavedQuote({
        surahId: quote.surahId,
        surahName: quote.surahName,
        verseNumber: quote.verseNumber,
        verseText: quote.verseText,
        pageNumber: quote.pageNumber,
      });
    } catch {
      // no-op
    }
  }, [onBookmarkQuote, quote, toggleSavedQuote]);

  const handleSharePress = useCallback(async () => {
    if (!quote || !sharePayload) return;

    try {
      if (onShareQuote) {
        await onShareQuote(sharePayload);
        return;
      }

      await Share.share({
        title: `${SURAH_PREFIX} ${quote.surahName}`,
        message: quoteExportText,
      });
    } catch {
      // no-op
    }
  }, [onShareQuote, quote, quoteExportText, sharePayload]);

  const handleDownloadPress = useCallback(async () => {
    if (!quote || !sharePayload) return;

    try {
      if (onDownloadQuote) {
        await onDownloadQuote(sharePayload);
        return;
      }

      const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!directory) {
        await Share.share({ message: quoteExportText });
        return;
      }

      const filename = `${DOWNLOAD_FILE_PREFIX}-${quote.surahId}-${quote.verseNumber}.txt`;
      const fileUri = `${directory}${filename}`;
      await FileSystem.writeAsStringAsync(fileUri, quoteExportText, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      await Share.share({
        title: `${SURAH_PREFIX} ${quote.surahName}`,
        message: quoteExportText,
        url: fileUri,
      });
    } catch {
      try {
        await Share.share({ message: quoteExportText });
      } catch {
        // no-op
      }
    }
  }, [onDownloadQuote, quote, quoteExportText, sharePayload]);

  const handleToggleTafsirFocus = useCallback(() => {
    if (!quote) return;
    setIsTafsirFocused((previous) => {
      const next = !previous;
      onToggleTafsirFocus?.(next, quote);
      return next;
    });
  }, [onToggleTafsirFocus, quote]);

  if (!quote) return null;

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <TouchableWithoutFeedback>
          <View style={[styles.card, { width: cardWidth, maxHeight: cardMaxHeight }]}>
            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={20} color="#7A8D92" />
            </Pressable>

            <View style={styles.contentBody}>
              <View style={styles.surahBadge}>
                <Text style={styles.surahBadgeText}>{headerLabel}</Text>
              </View>

              <View style={[styles.verseSection, { height: verseSectionHeight }]}>
                <ScrollView
                  style={styles.verseScroll}
                  contentContainerStyle={styles.verseScrollContent}
                  onLayout={handleVerseViewportLayout}
                  onContentSizeChange={handleVerseContentSizeChange}
                  showsVerticalScrollIndicator={isVerseOverflowing}
                  nestedScrollEnabled
                >
                  <Text
                    onTextLayout={handleVerseTextLayout}
                    style={[
                      styles.verseText,
                      {
                        fontSize: currentVerseFontSize,
                        lineHeight: verseLineHeight,
                      },
                    ]}
                  >
                    {verseDisplayParts.map((part, index) =>
                      WAQF_MARKER_TOKEN_REGEX.test(part) ? (
                        <Text
                          key={`waqf-${index}`}
                          style={[
                            styles.waqfMarker,
                            {
                              fontSize: Math.round(currentVerseFontSize * 0.84),
                              lineHeight: verseLineHeight,
                            },
                          ]}
                        >
                          {part}
                        </Text>
                      ) : (
                        <Text key={`verse-${index}`}>{part}</Text>
                      ),
                    )}
                    <Text
                      style={[
                        styles.verseAyahEndText,
                        {
                          fontSize: Math.round(currentVerseFontSize * 0.7),
                          lineHeight: verseLineHeight + 6,
                        },
                      ]}
                    >
                      {" "}
                      {verseNumberLabel}
                    </Text>
                  </Text>
                </ScrollView>
              </View>

              <View style={styles.tafsirDivider} />

              <View style={styles.tafsirHeaderRow}>
                <Ionicons name="book-outline" size={16} color="#C48B59" />
                <Text style={styles.tafsirLabel}>{TAFSIR_LABEL}</Text>
              </View>

              <View style={[styles.tafsirSection, { height: tafsirSectionHeight }]}>
                <View style={styles.tafsirAccentLine} />
                <ScrollView
                  style={styles.tafsirScroll}
                  contentContainerStyle={styles.tafsirScrollContent}
                  onLayout={handleTafsirViewportLayout}
                  onContentSizeChange={handleTafsirContentSizeChange}
                  showsVerticalScrollIndicator={isTafsirOverflowing}
                  nestedScrollEnabled
                >
                  <Text
                    onTextLayout={handleTafsirTextLayout}
                    style={[
                      styles.tafsirText,
                      {
                        fontSize: currentTafsirFontSize,
                        lineHeight: tafsirLineHeight,
                      },
                      tafsirError ? styles.tafsirErrorText : null,
                    ]}
                  >
                    {effectiveTafsirText}
                  </Text>
                </ScrollView>
              </View>
            </View>

            <View style={styles.controlsDock}>
              {showVerseNavigation ? (
                <DockActionButton
                  icon="chevron-back"
                  size={navButtonSize}
                  iconSize={navIconSize}
                  accessibilityLabel="Next verse"
                  onPress={() => {
                    if (canGoNextVerse) {
                      onNextVerse?.();
                    }
                  }}
                  isDisabled={!canGoNextVerse}
                  horizontalMargin={dockActionHorizontalMargin}
                />
              ) : null}

              <DockActionButton
                icon={isQuoteBookmarked ? "bookmark" : "bookmark-outline"}
                size={regularButtonSize}
                iconSize={regularIconSize}
                accessibilityLabel="Save quote"
                onPress={() => void handleBookmarkPress()}
                isActive={isQuoteBookmarked}
                horizontalMargin={dockActionHorizontalMargin}
              />

              <DockActionButton
                icon="share-social-outline"
                size={regularButtonSize}
                iconSize={regularIconSize}
                accessibilityLabel="Share quote"
                onPress={() => void handleSharePress()}
                horizontalMargin={dockActionHorizontalMargin}
              />

              <DockActionButton
                icon={isVerseAudioLoading ? "hourglass-outline" : "play"}
                size={playButtonSize}
                iconSize={playIconSize}
                accessibilityLabel="Play verse audio"
                onPress={() => onPlayVerse(quote)}
                isPrimary
                horizontalMargin={dockActionHorizontalMargin}
              />

              <DockActionButton
                icon={isTafsirFocused ? "book" : "book-outline"}
                size={regularButtonSize}
                iconSize={regularIconSize}
                accessibilityLabel="Toggle tafsir focus mode"
                onPress={handleToggleTafsirFocus}
                isActive={isTafsirFocused}
                horizontalMargin={dockActionHorizontalMargin}
              />

              <DockActionButton
                icon="download-outline"
                size={regularButtonSize}
                iconSize={regularIconSize}
                accessibilityLabel="Download quote text"
                onPress={() => void handleDownloadPress()}
                horizontalMargin={dockActionHorizontalMargin}
              />

              {showVerseNavigation ? (
                <DockActionButton
                  icon="chevron-forward"
                  size={navButtonSize}
                  iconSize={navIconSize}
                  accessibilityLabel="Previous verse"
                  onPress={() => {
                    if (canGoPreviousVerse) {
                      onPreviousVerse?.();
                    }
                  }}
                  isDisabled={!canGoPreviousVerse}
                  horizontalMargin={dockActionHorizontalMargin}
                />
              ) : null}
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(22, 28, 34, 0.36)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
  },
  card: {
    borderRadius: 34,
    backgroundColor: "#FAF9F6",
    borderWidth: 1,
    borderColor: "#EDE9E1",
    shadowColor: "#2E3E48",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 8,
    overflow: "hidden",
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  closeButton: {
    position: "absolute",
    left: 16,
    top: 14,
    zIndex: 5,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#F0EEE9",
    alignItems: "center",
    justifyContent: "center",
  },
  contentBody: {
    marginTop: 30,
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
  },
  surahBadge: {
    alignSelf: "center",
    borderRadius: 999,
    backgroundColor: "#E7F4F6",
    borderWidth: 1,
    borderColor: "#D3EBEF",
    minHeight: 60,
    paddingHorizontal: 24,
    justifyContent: "center",
  },
  surahBadgeText: {
    fontFamily: "Scheherazade",
    fontSize: 28,
    lineHeight: 34,
    color: "#204048",
    textAlign: "center",
    writingDirection: "rtl",
    includeFontPadding: false,
    textAlignVertical: "center",
    marginTop: Platform.OS === "ios" ? 10 : 8,
  },
  verseSection: {
    marginTop: 12,
    paddingHorizontal: 6,
    paddingVertical: 4,
    minHeight: 0,
  },
  verseScroll: {
    flex: 1,
  },
  verseScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 20,
  },
  verseText: {
    fontFamily: Platform.select({
      ios: "UthmanicHafs",
      android: "Madani",
      default: "UthmanicHafs",
    }),
    color: "#102431",
    textAlign: "center",
    writingDirection: "rtl",
    includeFontPadding: true,
  },
  waqfMarker: {
    fontFamily: "Amiri",
    color: "#102431",
  },
  verseAyahEndText: {
    fontFamily: Platform.select({
      ios: "UthmanicHafs",
      android: "Madani",
      default: "UthmanicHafs",
    }),
    color: "#163243",
    includeFontPadding: true,
    textAlignVertical: "center",
  },
  tafsirDivider: {
    height: 1,
    backgroundColor: "#E8E4DD",
    marginTop: 6,
    marginBottom: 10,
  },
  tafsirHeaderRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "flex-start",
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  tafsirLabel: {
    fontFamily: "Amiri",
    fontSize: 20,
    lineHeight: 24,
    color: "#C48B59",
    marginRight: 6,
    writingDirection: "rtl",
  },
  tafsirSection: {
    position: "relative",
    borderRadius: 16,
    backgroundColor: "#FCFBF8",
    borderWidth: 1,
    borderColor: "#ECE7DE",
    paddingRight: 10,
    overflow: "hidden",
    minHeight: 0,
  },
  tafsirAccentLine: {
    position: "absolute",
    right: 0,
    top: 10,
    bottom: 10,
    width: 2,
    backgroundColor: "#D2EBEF",
    borderRadius: 99,
    zIndex: 1,
  },
  tafsirScroll: {
    flex: 1,
  },
  tafsirScrollContent: {
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  tafsirText: {
    fontFamily: "Amiri",
    color: "#243845",
    textAlign: "right",
    writingDirection: "rtl",
  },
  tafsirErrorText: {
    color: "#8A4450",
  },
  controlsDock: {
    marginTop: 14,
    borderRadius: 999,
    backgroundColor: "#F1EFEA",
    borderWidth: 1,
    borderColor: "#E9E4DB",
    paddingVertical: 12,
    paddingHorizontal: 8,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
  },
  dockActionPressable: {
    alignItems: "center",
    justifyContent: "center",
  },
  dockActionCircle: {
    alignItems: "center",
    justifyContent: "center",
  },
  dockActionCirclePrimary: {
    backgroundColor: "#AED9E0",
    shadowColor: "#7CBCC6",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 4,
  },
  dockActionCircleSecondary: {
    backgroundColor: "#F9F8F5",
    borderWidth: 1,
    borderColor: "#E4E9E8",
  },
  dockActionCircleActive: {
    backgroundColor: "#D8EEF2",
    borderColor: "#B8DEE5",
  },
  dockActionCircleDisabled: {
    backgroundColor: "#F4F2ED",
    borderColor: "#E8E2D8",
  },
  dockActionPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.97 }],
  },
  dockActionDisabled: {
    opacity: 0.7,
  },
});

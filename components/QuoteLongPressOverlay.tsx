import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GestureResponderEvent,
  LayoutChangeEvent,
} from "react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type {
  MushafPage,
  MushafPageLines,
} from "../utils/mushafData";
import { MUSHAF_PAGES, loadMushafPage } from "../utils/mushafData";
import {
  getFallbackQuranTextBox,
  resolveQuranTextBox,
  type QuranTextBox,
} from "../utils/quranTextBox";
import {
  buildQuoteLineMappings,
  resolveQuoteFromLinePress,
  type QuoteLineMapping,
  type QuoteTokenLayout,
  type QuoteVerseSelection,
} from "../utils/quoteVerseMapping";

const LINE_SLOT_COUNT = 15;
const LONG_PRESS_DELAY_MS = 280;
const MIN_WORD_FONT_SIZE = 15;
const SPECIAL_CROP_RATIO = 0.01;
const MARKER_CROP_RATIO_LEFT = 0.9;
const MARKER_CROP_RATIO_RIGHT = 0.12;
const MARKER_SHIFT_RATIO_EVEN = 0.55;
const MARKER_SHIFT_RATIO_ODD = 0.55;
const MARKER_SHIFT_PIXEL_OFFSET = -2;

const PAGE_BY_NUMBER = new Map<number, MushafPage>(
  MUSHAF_PAGES.map((page) => [page.pageNumber, page]),
);

type OverlayLayout = {
  regionLeft: number;
  regionTop: number;
  regionWidth: number;
  regionHeight: number;
  lineSlotHeight: number;
  wordFontSize: number;
  lineHorizontalPadding: number;
  tokenHorizontalMargin: number;
};

export interface QuoteLongPressOverlayProps {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  enabled: boolean;
  onQuoteDetected: (selection: QuoteVerseSelection) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function QuoteLongPressOverlay({
  pageNumber,
  pageWidth,
  pageHeight,
  enabled,
  onQuoteDetected,
}: QuoteLongPressOverlayProps) {
  const [pageLines, setPageLines] = useState<MushafPageLines | null>(null);
  const [textBox, setTextBox] = useState<QuranTextBox>(() =>
    getFallbackQuranTextBox(pageNumber),
  );

  const tokenLayoutsByLineRef = useRef<Map<number, QuoteTokenLayout[]>>(
    new Map(),
  );
  const lineWidthsRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    let isActive = true;
    setPageLines(null);

    loadMushafPage(pageNumber).then((loadedPage) => {
      if (!isActive) return;
      setPageLines(loadedPage);
    });

    return () => {
      isActive = false;
    };
  }, [pageNumber]);

  useEffect(() => {
    let isActive = true;
    setTextBox(getFallbackQuranTextBox(pageNumber));

    resolveQuranTextBox(pageNumber).then((resolvedBox) => {
      if (!isActive) return;
      setTextBox(resolvedBox);
    });

    return () => {
      isActive = false;
    };
  }, [pageNumber]);

  const mushafPage = useMemo(
    () => PAGE_BY_NUMBER.get(pageNumber) ?? null,
    [pageNumber],
  );

  const lineMappings = useMemo(
    () => buildQuoteLineMappings(mushafPage, pageLines),
    [mushafPage, pageLines],
  );

  useEffect(() => {
    const activeLineNumbers = new Set(
      lineMappings.map((line) => line.lineNumber),
    );

    tokenLayoutsByLineRef.current.forEach((_, lineNumber) => {
      if (!activeLineNumbers.has(lineNumber)) {
        tokenLayoutsByLineRef.current.delete(lineNumber);
      }
    });

    lineWidthsRef.current.forEach((_, lineNumber) => {
      if (!activeLineNumbers.has(lineNumber)) {
        lineWidthsRef.current.delete(lineNumber);
      }
    });
  }, [lineMappings]);

  const pageMarkerShift = useMemo(() => {
    if (!pageWidth) return 0;

    const isSpecialPage = pageNumber === 1 || pageNumber === 2;
    const isEvenPage = pageNumber % 2 === 0;
    const maskRatio = isSpecialPage
      ? SPECIAL_CROP_RATIO
      : isEvenPage
        ? 1 - MARKER_CROP_RATIO_LEFT
        : MARKER_CROP_RATIO_RIGHT;
    const shiftBase = pageWidth * maskRatio * (
      isEvenPage ? MARKER_SHIFT_RATIO_EVEN : MARKER_SHIFT_RATIO_ODD
    );
    const direction = isEvenPage ? -1 : 1;

    return shiftBase * direction + MARKER_SHIFT_PIXEL_OFFSET;
  }, [pageNumber, pageWidth]);

  const layout = useMemo<OverlayLayout | null>(() => {
    if (!pageWidth || !pageHeight) return null;

    const regionLeft = pageWidth * textBox.xRatio;
    const regionTop = pageHeight * textBox.yRatio;
    const regionWidth = pageWidth * textBox.widthRatio;
    const regionHeight = pageHeight * textBox.heightRatio;
    const lineSlotHeight = regionHeight / LINE_SLOT_COUNT;
    const wordFontSize = Math.max(MIN_WORD_FONT_SIZE, lineSlotHeight * 0.53);
    const lineHorizontalPadding = Math.max(2, regionWidth * 0.012);
    const tokenHorizontalMargin = Math.max(1, lineSlotHeight * 0.035);

    return {
      regionLeft,
      regionTop,
      regionWidth,
      regionHeight,
      lineSlotHeight,
      wordFontSize,
      lineHorizontalPadding,
      tokenHorizontalMargin,
    };
  }, [pageHeight, pageWidth, textBox]);

  const handleLineLayout = useCallback(
    (lineNumber: number) => (event: LayoutChangeEvent) => {
      lineWidthsRef.current.set(lineNumber, event.nativeEvent.layout.width);
    },
    [],
  );

  const handleTokenLayout = useCallback(
    (lineNumber: number, tokenIndex: number) => (event: LayoutChangeEvent) => {
      const { x, width } = event.nativeEvent.layout;
      const existing = tokenLayoutsByLineRef.current.get(lineNumber) ?? [];
      const nextLayouts = existing.filter((item) => item.tokenIndex !== tokenIndex);
      nextLayouts.push({ tokenIndex, x, width });
      tokenLayoutsByLineRef.current.set(lineNumber, nextLayouts);
    },
    [],
  );

  const handleLineLongPress = useCallback(
    (line: QuoteLineMapping, event: GestureResponderEvent) => {
      if (!layout) return;

      const measuredLineWidth = lineWidthsRef.current.get(line.lineNumber);
      const fallbackLineWidth = layout.regionWidth - layout.lineHorizontalPadding * 2;
      const lineWidth = Math.max(1, measuredLineWidth ?? fallbackLineWidth);
      const locationX = clamp(event.nativeEvent.locationX, 0, lineWidth);

      const quote = resolveQuoteFromLinePress({
        line,
        locationX,
        lineWidth,
        pageNumber,
        tokenLayouts: tokenLayoutsByLineRef.current.get(line.lineNumber),
      });

      if (quote) {
        onQuoteDetected(quote);
      }
    },
    [layout, onQuoteDetected, pageNumber],
  );

  if (!enabled || !layout || !lineMappings.length) return null;

  return (
    <View pointerEvents="box-none" style={styles.container}>
      <View
        style={[
          styles.textRegion,
          {
            left: layout.regionLeft,
            top: layout.regionTop,
            width: layout.regionWidth,
            height: layout.regionHeight,
            transform: [{ translateX: pageMarkerShift }],
          },
        ]}
      >
        {lineMappings.map((line) => {
          const lineSlotIndex = Math.max(
            0,
            Math.min(LINE_SLOT_COUNT - 1, line.lineNumber - 1),
          );
          const lineTop = lineSlotIndex * layout.lineSlotHeight;

          return (
            <Pressable
              key={`quote-line-${line.lineNumber}`}
              onLayout={handleLineLayout(line.lineNumber)}
              onLongPress={(event) => handleLineLongPress(line, event)}
              delayLongPress={LONG_PRESS_DELAY_MS}
              accessibilityRole="button"
              accessibilityLabel="Preview verse quote"
              style={[
                styles.linePressTarget,
                {
                  top: lineTop,
                  height: layout.lineSlotHeight,
                  paddingHorizontal: layout.lineHorizontalPadding,
                },
              ]}
            >
              <View pointerEvents="none" style={styles.measureLine}>
                {line.wordTokens.map((token) => (
                  <View
                    key={`${line.lineNumber}-${token.tokenIndex}`}
                    onLayout={handleTokenLayout(line.lineNumber, token.tokenIndex)}
                  >
                    <Text
                      style={[
                        styles.measureWord,
                        {
                          fontSize: layout.wordFontSize,
                          lineHeight: Math.round(layout.wordFontSize * 1.34),
                          marginHorizontal: layout.tokenHorizontalMargin,
                        },
                      ]}
                    >
                      {token.text}
                    </Text>
                  </View>
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },
  textRegion: {
    position: "absolute",
  },
  linePressTarget: {
    position: "absolute",
    left: 0,
    right: 0,
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  measureLine: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "flex-start",
    opacity: 0,
  },
  measureWord: {
    fontFamily: "UthmanicHafs",
    color: "transparent",
  },
});

export default memo(QuoteLongPressOverlay);

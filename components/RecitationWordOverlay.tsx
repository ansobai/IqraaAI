import React, { memo, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { MushafPageLines, MushafLineWord } from "../utils/mushafData";
import {
  getFallbackQuranTextBox,
  resolveQuranTextBox,
  type QuranTextBox,
} from "../utils/quranTextBox";

type OverlayToken = {
  text: string;
  charType: string;
  wordIndex: number | null;
};

type OverlayLine = {
  lineNumber: number;
  tokens: OverlayToken[];
};

export interface RecitationWordOverlayProps {
  pageData: MushafPageLines | null;
  activeWordIndex: number | null;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}

const HIGHLIGHT_COLOR = "#D32F2F";
const LINE_SLOT_COUNT = 15;
const MIN_WORD_FONT_SIZE = 15;
const SPECIAL_CROP_RATIO = 0.01;
const MARKER_CROP_RATIO_LEFT = 0.9;
const MARKER_CROP_RATIO_RIGHT = 0.12;
const MARKER_SHIFT_RATIO_EVEN = 0.55;
const MARKER_SHIFT_RATIO_ODD = 0.55;
const MARKER_SHIFT_PIXEL_OFFSET = -2;

const toOverlayLines = (pageData: MushafPageLines): OverlayLine[] => {
  let wordCursor = 0;

  return pageData.lines
    .map((line) => {
      const tokens: OverlayToken[] = line.words.map((word: MushafLineWord) => {
        if (word.charType !== "word") {
          return {
            text: word.text,
            charType: word.charType,
            wordIndex: null,
          };
        }

        const token: OverlayToken = {
          text: word.text,
          charType: word.charType,
          wordIndex: wordCursor,
        };
        wordCursor += 1;
        return token;
      });

      return {
        lineNumber: line.lineNumber,
        tokens,
      };
    })
    .sort((left, right) => left.lineNumber - right.lineNumber);
};

function RecitationWordOverlay({
  pageData,
  activeWordIndex,
  pageNumber,
  pageWidth,
  pageHeight,
}: RecitationWordOverlayProps) {
  const overlayLines = useMemo(
    () => (pageData ? toOverlayLines(pageData) : []),
    [pageData],
  );
  const [textBox, setTextBox] = useState<QuranTextBox>(() =>
    getFallbackQuranTextBox(pageNumber),
  );

  useEffect(() => {
    let isActive = true;
    setTextBox(getFallbackQuranTextBox(pageNumber));

    resolveQuranTextBox(pageNumber).then((resolvedBox) => {
      if (isActive) {
        setTextBox(resolvedBox);
      }
    });

    return () => {
      isActive = false;
    };
  }, [pageNumber]);

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

  const layout = useMemo(() => {
    if (!pageWidth || !pageHeight) return null;

    const regionLeft = pageWidth * textBox.xRatio;
    const regionTop = pageHeight * textBox.yRatio;
    const regionWidth = pageWidth * textBox.widthRatio;
    const regionHeight = pageHeight * textBox.heightRatio;
    const lineSlotHeight = regionHeight / LINE_SLOT_COUNT;
    const wordFontSize = Math.max(MIN_WORD_FONT_SIZE, lineSlotHeight * 0.53);
    const markerFontSize = Math.max(12, wordFontSize * 0.88);
    const lineHorizontalPadding = Math.max(2, regionWidth * 0.012);
    const tokenHorizontalMargin = Math.max(1, lineSlotHeight * 0.035);

    return {
      regionLeft,
      regionTop,
      regionWidth,
      regionHeight,
      lineSlotHeight,
      wordFontSize,
      markerFontSize,
      lineHorizontalPadding,
      tokenHorizontalMargin,
    };
  }, [pageHeight, pageWidth, textBox]);

  if (!pageData || !layout || activeWordIndex == null || activeWordIndex < 0) {
    return null;
  }

  const transparentWordStyle = {
    fontFamily: "UthmanicHafs" as const,
    fontSize: layout.wordFontSize,
    lineHeight: Math.round(layout.wordFontSize * 1.34),
    color: "transparent" as const,
    marginHorizontal: layout.tokenHorizontalMargin,
  };

  const highlightedWordStyle = {
    ...transparentWordStyle,
    color: HIGHLIGHT_COLOR,
  };

  const markerSpacerStyle = {
    fontFamily: "UthmanicHafs" as const,
    fontSize: layout.markerFontSize,
    lineHeight: Math.round(layout.markerFontSize * 1.3),
    color: "transparent" as const,
    marginHorizontal: layout.tokenHorizontalMargin,
  };

  return (
    <View pointerEvents="none" style={styles.container}>
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
        {overlayLines.map((line) => {
          const lineSlotIndex = Math.max(
            0,
            Math.min(LINE_SLOT_COUNT - 1, line.lineNumber - 1),
          );
          const lineTop = lineSlotIndex * layout.lineSlotHeight;

          return (
            <View
              key={`line-${line.lineNumber}`}
              style={[
                styles.line,
                {
                  top: lineTop,
                  height: layout.lineSlotHeight,
                  paddingHorizontal: layout.lineHorizontalPadding,
                },
              ]}
            >
              {line.tokens.map((token, tokenIndex) => {
                if (token.wordIndex == null || token.charType !== "word") {
                  return (
                    <Text
                      key={`${line.lineNumber}-${tokenIndex}`}
                      style={markerSpacerStyle}
                    >
                      {token.text}
                    </Text>
                  );
                }

                return (
                  <Text
                    key={`${line.lineNumber}-${tokenIndex}`}
                    style={
                      token.wordIndex === activeWordIndex
                        ? highlightedWordStyle
                        : transparentWordStyle
                    }
                  >
                    {token.text}
                  </Text>
                );
              })}
            </View>
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
  line: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row-reverse",
    flexWrap: "nowrap",
    justifyContent: "flex-start",
    alignItems: "center",
    overflow: "hidden",
  },
});

export default memo(RecitationWordOverlay);

import React, { memo, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";
import { SvgXml } from "react-native-svg";
import { loadQuranPageSvgXml } from "../utils/quranSvgRegistry";

const DEFAULT_HIGHLIGHT_COLOR = "#2E8B57";
const PAGE_BACKGROUND_COLOR = "#FFFAF2";

// SVG dimensions (all pages have the same size)
const SVG_WIDTH = 510.236;
const SVG_HEIGHT = 729.448;
// Crop ratios for hiding side markers (asymmetric due to SVG content)
const MARKER_CROP_RATIO_LEFT = 0.9; // Even pages: markers on left
const MARKER_CROP_RATIO_RIGHT = 0.12; // Odd pages: markers on right
// Shift ratios to re-center content when masking (tune per parity)
const MARKER_SHIFT_RATIO_EVEN = 0.55;
const MARKER_SHIFT_RATIO_ODD = 0.55;
// In mini mode we keep markers visible, so apply a smaller centering shift.
const MINI_SHIFT_RATIO_EVEN = 0.4;
const MINI_SHIFT_RATIO_ODD = 0.4;
// Special pages 1-2 have minimal markers
const SPECIAL_CROP_RATIO = 0.01;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Adjusts the SVG viewBox to optionally crop out side markers.
 * When hideSideMarkers is true, crops from the appropriate side
 * based on page number (even pages have markers on left, odd on right).
 */
const adjustSvgViewBox = (
  svgXml: string,
  hideSideMarkers: boolean,
  pageNumber: number,
): string => {
  const isSpecialPage = pageNumber === 1 || pageNumber === 2;
  const isEvenPage = pageNumber % 2 === 0;

  let viewBox: string;
  if (!hideSideMarkers) {
    // Show full SVG with markers
    viewBox = `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`;
  } else if (isEvenPage) {
    // Even page: markers on left, crop from left
    const cropRatio = isSpecialPage
      ? SPECIAL_CROP_RATIO
      : MARKER_CROP_RATIO_LEFT;
    const cropWidth = SVG_WIDTH * cropRatio;
    viewBox = `${cropWidth} 0 ${SVG_WIDTH - cropWidth} ${SVG_HEIGHT}`;
  } else {
    // Odd page: markers on right, crop from right
    const cropRatio = isSpecialPage
      ? SPECIAL_CROP_RATIO
      : MARKER_CROP_RATIO_RIGHT;
    const cropWidth = SVG_WIDTH * cropRatio;
    viewBox = `0 0 ${SVG_WIDTH - cropWidth} ${SVG_HEIGHT}`;
  }

  // Remove existing viewBox if present, then add our computed one
  const withoutViewBox = svgXml.replace(/\s*viewBox="[^"]*"/i, "");
  return withoutViewBox.replace(
    /<svg\b([^>]*)>/i,
    `<svg$1 viewBox="${viewBox}">`,
  );
};

const highlightSvgXml = (
  svgXml: string,
  highlightedVerseId: string,
  highlightColor: string,
): string => {
  if (!highlightedVerseId) return svgXml;

  const escapedId = escapeRegExp(highlightedVerseId);
  const tagRegex = new RegExp(
    `<[^>]*\\s(?:id|data-verse-id)="${escapedId}"[^>]*\\/?>`,
    "gi",
  );

  return svgXml.replace(tagRegex, (tag) => {
    if (/\sfill="/i.test(tag)) {
      return tag.replace(/\sfill="[^"]*"/i, ` fill="${highlightColor}"`);
    }

    return tag.replace(
      new RegExp("/?>$"),
      (ending) => ` fill="${highlightColor}"${ending}`,
    );
  });
};

export interface QuranPageProps {
  pageNumber: number;
  highlightedVerseId?: string;
  highlightColor?: string;
  shouldRender?: boolean;
  hideSideMarkers?: boolean;
  markerMaskProgress?: SharedValue<number> | Readonly<SharedValue<number>>;
  pageWidth?: number;
}

function QuranPage({
  pageNumber,
  highlightedVerseId,
  highlightColor = DEFAULT_HIGHLIGHT_COLOR,
  shouldRender = true,
  hideSideMarkers = false,
  markerMaskProgress,
  pageWidth,
}: QuranPageProps) {
  const [svgXml, setSvgXml] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    if (!shouldRender) {
      setSvgXml(null);
      return () => {
        isActive = false;
      };
    }

    setSvgXml(null);
    loadQuranPageSvgXml(pageNumber).then((xml) => {
      if (isActive) {
        setSvgXml(xml);
      }
    });

    return () => {
      isActive = false;
    };
  }, [pageNumber, shouldRender]);

  const shouldCropMarkers = hideSideMarkers && !markerMaskProgress;

  const renderedXml = useMemo(() => {
    if (!svgXml) return null;
    const withViewBox = adjustSvgViewBox(svgXml, shouldCropMarkers, pageNumber);
    if (!highlightedVerseId) return withViewBox;
    return highlightSvgXml(withViewBox, highlightedVerseId, highlightColor);
  }, [
    svgXml,
    shouldCropMarkers,
    pageNumber,
    highlightedVerseId,
    highlightColor,
  ]);

  const isSpecialPage = pageNumber === 1 || pageNumber === 2;
  const isEvenPage = pageNumber % 2 === 0;
  const maskRatio = isSpecialPage
    ? SPECIAL_CROP_RATIO
    : isEvenPage
      ? 1 - MARKER_CROP_RATIO_LEFT
      : MARKER_CROP_RATIO_RIGHT;
  const contentWidth = pageWidth ?? SVG_WIDTH;
  const maskWidth = contentWidth * maskRatio;
  const maskSideStyle = isEvenPage ? { left: 0 } : { right: 0 };
  const shouldShowMask = Boolean(markerMaskProgress);

  const markerMaskStyle = useAnimatedStyle(() => {
    const progress = markerMaskProgress ? markerMaskProgress.value : 0;
    return {
      opacity: progress,
    };
  }, [markerMaskProgress]);

  const contentShiftStyle = useAnimatedStyle(() => {
    if (!markerMaskProgress) {
      return { transform: [{ translateX: 0 }] };
    }
    const progress = markerMaskProgress.value;
    const direction = isEvenPage ? -1 : 1;
    const evenShift = contentWidth * maskRatio * MARKER_SHIFT_RATIO_EVEN;
    const oddShift = contentWidth * maskRatio * MARKER_SHIFT_RATIO_ODD;
    const shiftBase = isEvenPage ? evenShift : oddShift;
    const evenMiniShift = contentWidth * maskRatio * MINI_SHIFT_RATIO_EVEN;
    const oddMiniShift = contentWidth * maskRatio * MINI_SHIFT_RATIO_ODD;
    const miniShift = isEvenPage ? evenMiniShift : oddMiniShift;
    const interpolatedShift = miniShift + (shiftBase - miniShift) * progress;
    const shift = interpolatedShift * direction - 2 * progress;
    return {
      transform: [{ translateX: shift }],
    };
  }, [isEvenPage, maskRatio, markerMaskProgress, contentWidth]);

  if (!renderedXml) {
    return (
      <View
        className="flex-1"
        style={{ backgroundColor: PAGE_BACKGROUND_COLOR }}
      />
    );
  }

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: PAGE_BACKGROUND_COLOR }}
    >
      <View className="flex-1">
        <Animated.View style={[{ flex: 1 }, contentShiftStyle]}>
          <SvgXml
            xml={renderedXml}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
          />
        </Animated.View>
        {shouldShowMask ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                top: 0,
                bottom: 0,
                width: maskWidth,
                backgroundColor: PAGE_BACKGROUND_COLOR,
              },
              maskSideStyle,
              markerMaskStyle,
            ]}
          />
        ) : null}
      </View>
    </View>
  );
}

export default memo(QuranPage);

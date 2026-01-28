import React, { memo, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { loadQuranPageSvgXml } from "../utils/quranSvgRegistry";

const DEFAULT_HIGHLIGHT_COLOR = "#2E8B57";

// SVG dimensions (all pages have the same size)
const SVG_WIDTH = 510.236;
const SVG_HEIGHT = 729.448;
// Crop ratios for hiding side markers (asymmetric due to SVG content)
const MARKER_CROP_RATIO_LEFT = 0.09;  // Even pages: markers on left
const MARKER_CROP_RATIO_RIGHT = 0.12; // Odd pages: markers on right
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
  pageNumber: number
): string => {
  const isSpecialPage = pageNumber === 1 || pageNumber === 2;
  const isEvenPage = pageNumber % 2 === 0;

  let viewBox: string;
  if (!hideSideMarkers) {
    // Show full SVG with markers
    viewBox = `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`;
  } else if (isEvenPage) {
    // Even page: markers on left, crop from left
    const cropRatio = isSpecialPage ? SPECIAL_CROP_RATIO : MARKER_CROP_RATIO_LEFT;
    const cropWidth = SVG_WIDTH * cropRatio;
    viewBox = `${cropWidth} 0 ${SVG_WIDTH - cropWidth} ${SVG_HEIGHT}`;
  } else {
    // Odd page: markers on right, crop from right
    const cropRatio = isSpecialPage ? SPECIAL_CROP_RATIO : MARKER_CROP_RATIO_RIGHT;
    const cropWidth = SVG_WIDTH * cropRatio;
    viewBox = `0 0 ${SVG_WIDTH - cropWidth} ${SVG_HEIGHT}`;
  }

  // Remove existing viewBox if present, then add our computed one
  const withoutViewBox = svgXml.replace(/\s*viewBox="[^"]*"/i, "");
  return withoutViewBox.replace(
    /<svg\b([^>]*)>/i,
    `<svg$1 viewBox="${viewBox}">`
  );
};

const highlightSvgXml = (
  svgXml: string,
  highlightedVerseId: string,
  highlightColor: string
): string => {
  if (!highlightedVerseId) return svgXml;

  const escapedId = escapeRegExp(highlightedVerseId);
  const tagRegex = new RegExp(
    `<[^>]*\\s(?:id|data-verse-id)="${escapedId}"[^>]*\\/?>`,
    "gi"
  );

  return svgXml.replace(tagRegex, (tag) => {
    if (/\sfill="/i.test(tag)) {
      return tag.replace(/\sfill="[^"]*"/i, ` fill="${highlightColor}"`);
    }

    return tag.replace(new RegExp("/?>$"), (ending) => ` fill="${highlightColor}"${ending}`);
  });
};

export interface QuranPageProps {
  pageNumber: number;
  highlightedVerseId?: string;
  highlightColor?: string;
  shouldRender?: boolean;
  hideSideMarkers?: boolean;
}

function QuranPage({
  pageNumber,
  highlightedVerseId,
  highlightColor = DEFAULT_HIGHLIGHT_COLOR,
  shouldRender = true,
  hideSideMarkers = false,
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

  const renderedXml = useMemo(() => {
    if (!svgXml) return null;
    const withViewBox = adjustSvgViewBox(svgXml, hideSideMarkers, pageNumber);
    if (!highlightedVerseId) return withViewBox;
    return highlightSvgXml(withViewBox, highlightedVerseId, highlightColor);
  }, [svgXml, hideSideMarkers, pageNumber, highlightedVerseId, highlightColor]);

  if (!renderedXml) {
    return <View className="flex-1 bg-[#FFFDF5]" />;
  }

  return (
    <View className="flex-1 bg-[#FFFDF5]">
      <SvgXml
        xml={renderedXml}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
      />
    </View>
  );
}

export default memo(QuranPage);

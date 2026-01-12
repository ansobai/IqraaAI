import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ARABIC_SURAHS } from "../constants/surahNames";
import type { MushafPage } from "../utils/mushafData";
import { toArabicNumber } from "../utils/toArabicNumbers";
import SurahBanner from "./SurahBanner";

const { width } = Dimensions.get("window");
const AnimatedView = Animated.createAnimatedComponent(View);

const LINE_COUNT = 15;
const CHAR_WIDTH_FACTOR = 0.5;
const ASPECT_RATIO = 1.45;
const BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ";
const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED\uFBBF]/g;
const ARABIC_LETTER = /[\u0621-\u064A]/;

type LineToken =
  | { kind: "word"; text: string }
  | { kind: "marker"; text: string };

type PageSegment =
  | { type: "text"; tokens: LineToken[]; length: number }
  | { type: "banner"; label: string }
  | { type: "basmalah" };

type LineItem =
  | { type: "text"; tokens: LineToken[]; isLast: boolean }
  | { type: "banner"; label: string }
  | { type: "basmalah" };

const normalizeSpace = (text: string) => text.replace(/\s+/g, " ").trim();

const stripDiacritics = (text: string) => text.replace(ARABIC_DIACRITICS, "");

const tokenLength = (token: LineToken) => stripDiacritics(token.text).length;

const insertTatweel = (text: string) => {
  const chars = text.split("");
  for (let i = 0; i < chars.length; i += 1) {
    if (ARABIC_LETTER.test(chars[i])) {
      chars.splice(i + 1, 0, "ـ");
      return chars.join("");
    }
  }

  return text;
};

const applyTatweel = (
  tokens: LineToken[],
  targetLength: number,
  shouldApply: boolean
) => {
  if (!shouldApply) return tokens;

  const currentLength = tokens.reduce(
    (sum, token) => sum + tokenLength(token),
    0
  );
  let remaining = targetLength - currentLength;
  if (remaining <= 0) return tokens;

  const indices = tokens
    .map((token, index) =>
      token.kind === "word" && ARABIC_LETTER.test(token.text) ? index : -1
    )
    .filter((index) => index >= 0);

  if (indices.length === 0) return tokens;

  const updated = tokens.map((token) => ({ ...token }));
  let cursor = 0;
  let safety = 0;

  while (remaining > 0 && safety < indices.length * (remaining + 2)) {
    const index = indices[cursor % indices.length];
    const token = updated[index];
    const nextText = insertTatweel(token.text);

    if (nextText !== token.text) {
      token.text = nextText;
      remaining -= 1;
    }

    cursor += 1;
    safety += 1;
  }

  return updated;
};

const buildTokensFromVerses = (
  verses: Array<{ verseNumber: string; text: string }>
) => {
  const tokens: LineToken[] = [];

  verses.forEach((verse) => {
    const words = normalizeSpace(verse.text).split(" ").filter(Boolean);
    words.forEach((word) => tokens.push({ kind: "word", text: word }));

    const ayahNumber = Number(verse.verseNumber);
    if (Number.isFinite(ayahNumber)) {
      tokens.push({
        kind: "marker",
        text: toArabicNumber(ayahNumber),
      });
    }
  });

  return tokens;
};

const splitTokensIntoLines = (tokens: LineToken[], linesCount: number) => {
  if (linesCount <= 0 || tokens.length === 0) return [] as LineToken[][];

  const totalLength = tokens.reduce(
    (sum, token) => sum + tokenLength(token),
    0
  );
  const lines: LineToken[][] = [];
  let consumedLength = 0;
  let cursor = 0;

  for (let lineIndex = 0; lineIndex < linesCount; lineIndex += 1) {
    const remainingLines = linesCount - lineIndex;
    const remainingLength = totalLength - consumedLength;
    const targetLength = Math.ceil(remainingLength / remainingLines);
    const lineTokens: LineToken[] = [];
    let lineLength = 0;

    while (cursor < tokens.length) {
      const token = tokens[cursor];
      const length = tokenLength(token);
      const isMarker = token.kind === "marker";

      if (
        lineTokens.length > 0 &&
        !isMarker &&
        lineLength + length > targetLength &&
        remainingLines > 1
      ) {
        break;
      }

      lineTokens.push(token);
      lineLength += length;
      consumedLength += length;
      cursor += 1;
    }

    const finalized = applyTatweel(
      lineTokens,
      targetLength,
      lineIndex < linesCount - 1
    );
    lines.push(finalized);
  }

  return lines;
};

const allocateLinesForSegments = (lengths: number[], totalLines: number) => {
  if (totalLines <= 0 || lengths.length === 0) return [];

  const minimums: number[] = lengths.map((len) => (len > 0 ? 1 : 0));
  const remaining =
    totalLines - minimums.reduce((sum, value) => sum + value, 0);

  if (remaining < 0) {
    return lengths.map((_, index) => (index < totalLines ? 1 : 0));
  }

  const totalLength = lengths.reduce((sum, value) => sum + value, 0) || 1;
  const rawShares = lengths.map((len) => (len / totalLength) * remaining);
  const base = rawShares.map((value) => Math.floor(value));
  const remainders = rawShares
    .map((value, index) => ({ index, remainder: value - base[index] }))
    .sort((a, b) => b.remainder - a.remainder);

  let allocated = base.reduce((sum, value) => sum + value, 0);
  let extra = remaining - allocated;

  const lines = base.map((value, index) => value + minimums[index]);
  let cursor = 0;

  while (extra > 0 && remainders.length > 0) {
    const target = remainders[cursor % remainders.length];
    lines[target.index] += 1;
    extra -= 1;
    cursor += 1;
  }

  return lines;
};

const buildPageSegments = (page: MushafPage): PageSegment[] => {
  const segments: PageSegment[] = [];

  page.surahs.forEach((surah) => {
    const verses = Array.isArray(surah.text) ? surah.text : [];
    const startsHere = verses[0]?.verseNumber === "1";

    if (startsHere) {
      segments.push({ type: "banner", label: `سورة ${surah.titleAr}` });
      if (surah.chapterNumber !== 9) {
        segments.push({ type: "basmalah" });
      }
    }

    let verseList = verses;
    if (startsHere && verseList.length > 0) {
      const firstText = normalizeSpace(verseList[0].text);
      if (firstText === BISMILLAH) {
        verseList = verseList.slice(1);
      } else if (firstText.startsWith(BISMILLAH)) {
        const trimmed = firstText.slice(BISMILLAH.length).trim();
        verseList = [
          { ...verseList[0], text: trimmed },
          ...verseList.slice(1),
        ].filter((verse) => normalizeSpace(verse.text).length > 0);
      }
    }

    const tokens = buildTokensFromVerses(verseList);
    const length = tokens.reduce((sum, token) => sum + tokenLength(token), 0);
    if (tokens.length > 0) {
      segments.push({ type: "text", tokens, length });
    }
  });

  return segments;
};

interface Props {
  page: MushafPage;
  onNextPage?: () => void;
  onPrevPage?: () => void;
  onJumpToSurah?: (surahId: number) => void;
}

export default function QuranPageView({
  page,
  onNextPage,
  onPrevPage,
  onJumpToSurah,
}: Props) {
  if (!page || !page.surahs || page.surahs.length === 0) return null;

  const surahName = page.surahs[0]?.titleAr ?? "الفاتحة";
  const SURAHS = ARABIC_SURAHS.map((name, i) => ({ id: i + 1, name }));

  // ------- MODE: full vs mini -------
  const [isMini, setIsMini] = useState(false);
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });

  const baseScale = useSharedValue(1);
  const pinchScale = useSharedValue(1);

  useEffect(() => {
    if (isMini) {
      baseScale.value = withTiming(0.65, { duration: 220 });
      pinchScale.value = 1;
    } else {
      baseScale.value = withTiming(1, { duration: 220 });
    }
  }, [isMini, baseScale, pinchScale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: baseScale.value * pinchScale.value }],
  }));

  const pinch = Gesture.Pinch()
    .enabled(!isMini)
    .onUpdate((event) => {
      let next = event.scale;

      // allow more shrinking so user can "pull" the page small
      if (next < 0.5) next = 0.5;
      if (next > 3) next = 3;

      pinchScale.value = next;
    })
    .onEnd(() => {
      // Condition that means: "User pinched out enough to want mini mode"
      if (pinchScale.value < 0.7) {
        pinchScale.value = 1; // reset zoom
        runOnJS(setIsMini)(true); // switch to mini mode
      }
      // Small pinch-out → snap back to full
      else if (pinchScale.value < 1) {
        pinchScale.value = withTiming(1, { duration: 180 });
      }
    });

  // ------- PAN – swipe left/right to change page (full mode only) -------
  const pan = Gesture.Pan()
    .enabled(!isMini)
    .onEnd((event) => {
      const dx = event.translationX;

      // 👉 swipe left → NEXT page
      if (dx < -60 && onNextPage) {
        runOnJS(onNextPage)();
      }
      // 👈 swipe right → PREVIOUS page
      else if (dx > 60 && onPrevPage) {
        runOnJS(onPrevPage)();
      }
    });

  const gesture = Gesture.Simultaneous(pinch, pan);

  // ------- DOUBLE TAP via Pressable -------
  const lastTapRef = useRef<number | null>(null);

  const handlePress = () => {
    const now = Date.now();
    if (lastTapRef.current && now - lastTapRef.current < 250) {
      lastTapRef.current = null;
      setIsMini((prev) => !prev);
    } else {
      lastTapRef.current = now;
    }
  };

  const lineHeight = useMemo(() => {
    if (!contentSize.height || !contentSize.width) return 0;
    const maxHeight = contentSize.width * ASPECT_RATIO;
    const effectiveHeight = Math.min(contentSize.height, maxHeight);
    return effectiveHeight / LINE_COUNT;
  }, [contentSize]);
  const baseFontSize = lineHeight ? lineHeight * 0.95 : 0;

  const segments = useMemo(() => buildPageSegments(page), [page]);

  const lines = useMemo(() => {
    const specials = segments.filter(
      (segment) => segment.type !== "text"
    ).length;
    const totalTextLines = Math.max(LINE_COUNT - specials, 0);
    const textSegments = segments.filter(
      (segment): segment is Extract<PageSegment, { type: "text" }> =>
        segment.type === "text"
    );
    const lengths = textSegments.map((segment) => segment.length);
    const allocations = allocateLinesForSegments(lengths, totalTextLines);

    const built: LineItem[] = [];
    let textIndex = 0;

    segments.forEach((segment) => {
      if (segment.type === "text") {
        const linesCount = allocations[textIndex] ?? 0;
        const split = splitTokensIntoLines(segment.tokens, linesCount);
        split.forEach((tokens, index) => {
          built.push({
            type: "text",
            tokens,
            isLast: index === split.length - 1,
          });
        });
        textIndex += 1;
      } else if (segment.type === "banner") {
        built.push({ type: "banner", label: segment.label });
      } else {
        built.push({ type: "basmalah" });
      }
    });

    while (built.length < LINE_COUNT) {
      built.push({ type: "text", tokens: [], isLast: true });
    }

    return built.slice(0, LINE_COUNT);
  }, [segments]);

  const maxLineLength = useMemo(() => {
    const lengths = lines
      .filter(
        (line): line is Extract<LineItem, { type: "text" }> =>
          line.type === "text"
      )
      .map((line) =>
        line.tokens.reduce((sum, token) => sum + tokenLength(token), 0)
      );
    return Math.max(1, ...lengths);
  }, [lines]);

  const widthBasedFontSize =
    contentSize.width && maxLineLength
      ? contentSize.width / (maxLineLength * CHAR_WIDTH_FACTOR)
      : baseFontSize;
  const fontSize =
    baseFontSize && widthBasedFontSize
      ? Math.min(baseFontSize, widthBasedFontSize)
      : baseFontSize;
  const markerFontSize = fontSize
    ? Math.max(10, Math.round(fontSize * 0.75))
    : 0;

  const handleContentLayout = (event: LayoutChangeEvent) => {
    const { width: layoutWidth, height: layoutHeight } =
      event.nativeEvent.layout;
    if (
      layoutWidth !== contentSize.width ||
      layoutHeight !== contentSize.height
    ) {
      setContentSize({ width: layoutWidth, height: layoutHeight });
    }
  };

  const renderLine = (line: LineItem, index: number) => {
    const lineStyle = { height: lineHeight, justifyContent: "center" } as const;

    if (line.type === "banner") {
      return (
        <View key={`line-banner-${index}`} style={lineStyle}>
          <SurahBanner
            label={line.label}
            size="lg"
            lineHeight={lineHeight}
            textStyle={{ color: "#000000" }}
          />
        </View>
      );
    }

    if (line.type === "basmalah") {
      return (
        <View key={`line-basmalah-${index}`} style={lineStyle}>
          <Text
            className="text-[#1F1F1F] font-uthmanic"
            style={{
              fontSize: fontSize * 0.75,
              lineHeight,
              textAlign: "center",
              writingDirection: "rtl",
            }}
          >
            {BISMILLAH}
          </Text>
        </View>
      );
    }

    return (
      <View key={`line-text-${index}`} style={lineStyle}>
        <Text
          className="text-[#1F1F1F] font-uthmanic"
          style={{
            fontSize,
            lineHeight,
            textAlign: "center",
            writingDirection: "rtl",
          }}
        >
          {line.tokens.map((token, tokenIndex) => {
            if (token.kind === "marker") {
              return (
                <Text
                  key={`marker-${index}-${tokenIndex}`}
                  className="text-[#BF8C34] font-uthmanic"
                  style={{
                    fontSize: markerFontSize,
                    lineHeight,
                  }}
                >
                  {" "}
                  {token.text}{" "}
                </Text>
              );
            }

            return (
              <Text key={`word-${index}-${tokenIndex}`}>{token.text} </Text>
            );
          })}
        </Text>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-[#FFFDF5]">
      {/* MAIN PAGE (scaled) */}
      <GestureDetector gesture={gesture}>
        <Pressable className="flex-1" onPress={handlePress}>
          <AnimatedView className="flex-1 items-center justify-center">
            <AnimatedView
              style={[{ width }, animatedStyle]}
              className="h-full justify-between pt-[60px] pb-[30px]"
            >
              {/* HEADER */}
              <View className="flex-row justify-between px-4 mb-2 items-center">
                <View className="px-3 py-1">
                  <Text className="text-[18px] font-semibold text-[#1F1F1F] font-uthmanic">
                    سورة {surahName}
                  </Text>
                </View>
                <View className="flex-row-reverse items-center gap-2 px-3 py-1">
                  <Text className="text-[18px] font-semibold text-[#1F1F1F] font-uthmanic">
                    الجزء
                  </Text>
                  <Text className="text-[18px] text-[#1F1F1F] font-amiri">
                    {toArabicNumber(page.pageNumber)}
                  </Text>
                </View>
              </View>

              {/* CONTENT */}
              <View
                className="flex-1 items-center justify-start pt-4"
                onLayout={handleContentLayout}
              >
                {lineHeight > 0 && fontSize > 0 && (
                  <View
                    className="justify-center w-[88%]"
                    style={{ height: lineHeight * LINE_COUNT }}
                  >
                    {lines.map(renderLine)}
                  </View>
                )}
              </View>

              {/* FOOTER */}
              <View className="items-center mb-2">
                <Text className="text-[16px] font-bold text-[#1F1F1F] font-amiri">
                  {toArabicNumber(page.pageNumber)}
                </Text>
              </View>
            </AnimatedView>
          </AnimatedView>
        </Pressable>
      </GestureDetector>

      {/* MINI MODE CONTROLS – OUTSIDE THE SCALED VIEW */}
      {isMini && (
        <>
          {/* TOP AREA: search + surah slider (stick to top) */}
          <View
            pointerEvents="box-none"
            className="absolute left-0 right-0 top-10 items-center z-50"
          >
            {/* SEARCH BAR (UI only for now) */}
            <View className="w-[90%] mb-3">
              <View className="flex-row-reverse items-center bg-[#F4EFE4] rounded-3xl px-4 py-2">
                <Text className="flex-1 text-right text-[#999] font-uthmanic">
                  ابحث في القرآن...
                </Text>
              </View>
            </View>

            {/* SURAH SLIDER – all ١١٤ سور, horizontally scrollable */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                flexDirection: "row-reverse",
                alignItems: "center",
                paddingHorizontal: 24,
              }}
            >
              {SURAHS.map((s) => {
                const active = s.name === surahName;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => onJumpToSurah && onJumpToSurah(s.id)}
                    className="items-center mx-3"
                  >
                    <SurahBanner
                      label={s.name}
                      size="md"
                      textStyle={{
                        color: active ? "#C79A3A" : "#1F1F1F",
                      }}
                    />

                    {/* underline / dot for active surah */}
                    <View className="h-[3px] w-10 mt-1 rounded-full bg-transparent">
                      {active && (
                        <View className="h-[3px] w-full bg-[#C79A3A] rounded-full" />
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* BOTTOM PAGE CONTROLS – stick to bottom */}
          <View
            pointerEvents="box-none"
            className="absolute left-0 right-0 bottom-10 items-center z-50"
          />
        </>
      )}
    </View>
  );
}

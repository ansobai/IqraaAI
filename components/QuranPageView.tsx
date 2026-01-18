import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  LayoutChangeEvent,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  ScrollView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { JUZ_NAMES } from "../constants/juzNames";
import { ARABIC_SURAHS } from "../constants/surahNames";
import type { MushafPage } from "../utils/mushafData";
import { toArabicNumber } from "../utils/toArabicNumbers";
import SurahBanner from "./SurahBanner";

const { width } = Dimensions.get("window");
const AnimatedView = Animated.createAnimatedComponent(View);

const LINE_COUNT = 15;
// KFGQPC Uthmanic Script is generally wider than standard fonts
const CHAR_WIDTH_FACTOR = 0.33;

const ASPECT_RATIO = 1.55;
const BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ";
const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED\uFBBF]/g;
const ARABIC_LETTER = /[\u0621-\u064A]/;
// Letters that do NOT connect to the following letter:
// Hamza (sometimes), Alif variants, Dal, Dhal, Ra, Zain, Waw, Alif Maksura (sometimes), Ta Marbuta
const NON_CONNECTING_AFTER =
  /[\u0621\u0622\u0623\u0624\u0625\u0627\u0629\u062F\u0630\u0631\u0632\u0648\u0649\u0671]/;

type LineToken =
  | { kind: "word"; text: string }
  | { kind: "marker"; text: string };

type PageSegment =
  | { type: "text"; tokens: LineToken[]; length: number; isSurahEnd: boolean }
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
    const char = chars[i];

    // 1) Must be an Arabic letter
    if (ARABIC_LETTER.test(char)) {
      // 2) If it's a non-connecting letter (like Waw or Alif), we cannot insert a tatweel after it
      if (NON_CONNECTING_AFTER.test(char)) {
        continue;
      }

      // 3) Skip over any diacritics to find the actual insertion point
      let insertIndex = i + 1;
      while (
        insertIndex < chars.length &&
        ARABIC_DIACRITICS.test(chars[insertIndex])
      ) {
        insertIndex++;
      }

      // 4) Ensure there is another letter after this point (don't add trailing tatweel)
      let hasNextLetter = false;
      for (let j = insertIndex; j < chars.length; j++) {
        // We only care if there is a base letter ahead, diacritics don't count as "next letter" connection target
        // but practically if there is any Arabic content ahead, we want to connect.
        // Let's be strict: search for next BASE letter.
        if (ARABIC_LETTER.test(chars[j])) {
          hasNextLetter = true;
          break;
        }
      }

      if (hasNextLetter) {
        chars.splice(insertIndex, 0, "ـ");
        return chars.join("");
      }
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
    // 1. Remove Rub El Hizb (Start symbol)
    let text = verse.text.replace(/\u06DE/g, "");

    // 2. Attach waqf marks to previous word (remove space before them)
    // The marks are usually: ۖ (sala), ۗ (qala), ۚ (jeem), ۛ (three dots), ۙ (laa), ۘ (meem)
    text = text.replace(/\s+([ۖۗۚۛۙۘ])/g, "$1");

    const words = normalizeSpace(text).split(" ").filter(Boolean);
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

const splitTokensIntoLines = (
  tokens: LineToken[],
  linesCount: number,
  justifyLastLine = false
) => {
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

    const isLastLine = lineIndex === linesCount - 1;
    const shouldApply = !isLastLine || justifyLastLine;

    const finalized = applyTatweel(lineTokens, targetLength, shouldApply);
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

    // Check if this segment contains the actual end of the Surah
    const lastVerse = verseList[verseList.length - 1];
    const isSurahEnd = Number(lastVerse?.verseNumber) === surah.verseCount;

    if (tokens.length > 0) {
      segments.push({ type: "text", tokens, length, isSurahEnd });
    }
  });

  return segments;
};

interface Props {
  page: MushafPage;
  onJumpToSurah?: (surahId: number) => void;
  isMini: boolean;
  onToggleMiniMode: () => void;
}

export default function QuranPageView({
  page,
  onJumpToSurah,
  isMini,
  onToggleMiniMode,
}: Props) {
  if (!page || !page.surahs || page.surahs.length === 0) return null;

  const surahName = page.surahs[0]?.titleAr ?? "الفاتحة";
  const SURAHS = ARABIC_SURAHS.map((name, i) => ({ id: i + 1, name }));

  // ------- MODE: full vs mini -------
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
        if (!isMini) {
          runOnJS(onToggleMiniMode)(); // switch to mini mode
        }
      }
      // Small pinch-out → snap back to full
      else if (pinchScale.value < 1) {
        pinchScale.value = withTiming(1, { duration: 180 });
      }
    });

  const gesture = pinch;

  // ------- DOUBLE TAP via Pressable -------
  const lastTapRef = useRef<number | null>(null);

  const handlePress = () => {
    const now = Date.now();
    if (lastTapRef.current && now - lastTapRef.current < 250) {
      lastTapRef.current = null;
      onToggleMiniMode();
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

  // Increase multiplier to 2.5 to make text larger relative to line height
  const baseFontSize = lineHeight ? lineHeight * 2.5 : 0;

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

        // Justify the last line of the segment ONLY if it is NOT the end of the Surah
        const justifyLast = !segment.isSurahEnd;

        const split = splitTokensIntoLines(
          segment.tokens,
          linesCount,
          justifyLast
        );

        split.forEach((tokens, index) => {
          // It is only "ragged" (flex-start) if it is the last line AND the segment is the Surah end
          const isRagged = index === split.length - 1 && segment.isSurahEnd;
          built.push({
            type: "text",
            tokens,
            isLast: isRagged,
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
      .map((line) => {
        const textLen = line.tokens.reduce(
          (sum, token) => sum + tokenLength(token),
          0
        );
        // Add "virtual" length for spaces between words to ensure we leave room for gaps
        const spaceCount = Math.max(0, line.tokens.length - 1);
        // Balanced weight (0.60) - sufficient for gaps but not overly conservative
          return textLen + spaceCount * 0.1;
      });
    return Math.max(1, ...lengths);
  }, [lines]);

  // Account for horizontal padding (16 on each side = 32, plus a safety buffer)
  const availableWidth = contentSize.width ? contentSize.width - 34 : 0;

  // Use the constant factor defined at the top
  const widthBasedFontSize =
    availableWidth && maxLineLength
      ? availableWidth / (maxLineLength * CHAR_WIDTH_FACTOR)
      : baseFontSize;

  const fontSize =
    baseFontSize && widthBasedFontSize
      ? Math.min(baseFontSize, widthBasedFontSize)
      : baseFontSize;

  const markerFontSize = fontSize
    ? Math.max(12, Math.round(fontSize * 0.98)) // 15% smaller than previous marker size
    : 0;
  const markerTextColor = "#5B3A0D";

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
            className="text-[#1F1F1F] font-madani"
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

    // Use Flexbox row-reverse for RTL with space-between for full justification
    // Only last line of a surah segment should use flex-start (ragged)
    const isRagged = line.isLast;

    return (
      <View
        key={`line-text-${index}`}
        style={[
          lineStyle,
          {
            flexDirection: "row-reverse",
            justifyContent: isRagged ? "flex-start" : "space-between",
            alignItems: "center",
            columnGap: isRagged ? 5 : 0, // Add explicit gap for ragged lines, justified lines manage space via space-between but we size for it now
          },
        ]}
      >
        {line.tokens.map((token, tokenIndex) => {
          if (token.kind === "marker") {
            return (
              <Text
                key={`marker-${index}-${tokenIndex}`}
                className="font-madani"
                style={{
                  color: markerTextColor,
                  fontSize: markerFontSize,
                  lineHeight,
                }}
              >
                {token.text}
              </Text>
            );
          }

          return (
            <Text
              key={`word-${index}-${tokenIndex}`}
              className="text-[#1F1F1F] font-madani"
              style={{
                fontSize,
                lineHeight,
              }}
            >
              {token.text}
            </Text>
          );
        })}
      </View>
    );
  };

  return (
    <View className="flex-1 bg-[#fff8e1]">
      {/* MAIN PAGE (scaled) */}
      <GestureDetector gesture={gesture}>
        <Pressable className="flex-1" onPress={handlePress}>
          <AnimatedView className="flex-1 items-center justify-center">
            <AnimatedView
              style={[{ width }, animatedStyle]}
              className="h-full justify-between pt-[60px] pb-[10px]"
            >
              {/* HEADER */}
              <View className="flex-row justify-between px-4 mb-2 items-center">
                <View className="px-3 py-1">
                  <Text className="text-[18px] font-bold text-[#1F1F1F] font-madani">
                    سورة {surahName}
                  </Text>
                </View>
                <View className="flex-row-reverse items-center gap-1 px-3 py-1">
                  <Text className="text-[18px] font-bold text-[#1F1F1F] font-madani">
                    الجزء {JUZ_NAMES[page.juzNumber ?? 1]}
                  </Text>
                </View>
              </View>

              {/* CONTENT */}
              <View
                className="flex-1 justify-start"
                style={{ paddingHorizontal: 16 }}
                onLayout={handleContentLayout}
              >
                {lineHeight > 0 && fontSize > 0 && (
                  <View
                    className="justify-center w-full"
                    style={{ height: lineHeight * LINE_COUNT }}
                  >
                    {lines.map(renderLine)}
                  </View>
                )}
              </View>

              {/* FOOTER */}
              <View className="items-center mb-2">
                <Text className="text-[16px] font-bold text-[#1F1F1F] font-madani">
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
                <Text className="flex-1 text-right text-[#999] font-madani">
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

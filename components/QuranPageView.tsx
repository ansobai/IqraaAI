import React, { useEffect, useRef, useState } from "react";
import { Dimensions, Pressable, ScrollView, Text, View } from "react-native";
import { FONTS } from "../constants/theme";
import { ReadyPage } from "../utils/quranProcessor";

import { useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ARABIC_SURAHS } from "../constants/surahNames";
import { toArabicNumber } from "../utils/toArabicNumbers";
import SurahBanner from "./SurahBanner";

const { width } = Dimensions.get("window");
const AnimatedView = Animated.createAnimatedComponent(View);
const ARABIC_SURAH_SET = new Set(ARABIC_SURAHS);

const toArabicSurahName = (name: string) => {
  const trimmed = name.trim();
  if (ARABIC_SURAH_SET.has(trimmed)) return trimmed;

  const emDashIndex = trimmed.indexOf("\u2014");
  if (emDashIndex >= 0) {
    const afterDash = trimmed.slice(emDashIndex + 1).trim();
    if (ARABIC_SURAH_SET.has(afterDash)) return afterDash;
  }

  const arabicMatch = trimmed.match(
    /[\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+)*/g
  );
  if (arabicMatch && arabicMatch.length > 0) {
    return arabicMatch[arabicMatch.length - 1];
  }

  return trimmed;
};

interface Props {
  page: ReadyPage;
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
  if (!page || !page.verses || page.verses.length === 0) return null;

  const firstVerse = page.verses[0];
  const surahName = toArabicSurahName(firstVerse.surah);
  const juzNumber = Math.ceil(page.pageNumber / 20);
  const SURAHS = ARABIC_SURAHS.map((name, i) => ({ id: i, name })).filter(
    (s) => s.id > 0
  );
  const router = useRouter();
  const currentSurahId = ARABIC_SURAHS.findIndex((n) => n === surahName);
  const currentSurahIndex = SURAHS.findIndex((s) => s.name === surahName);

  const prevSurah =
    currentSurahIndex > 0 ? SURAHS[currentSurahIndex - 1] : null;

  const nextSurah =
    currentSurahIndex >= 0 && currentSurahIndex < SURAHS.length - 1
      ? SURAHS[currentSurahIndex + 1]
      : null;

  // ------- MODE: full vs mini -------
  const [isMini, setIsMini] = useState(false);

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
        runOnJS(setIsMini)(true); // 🔥 switch to mini mode
      }
      // Small pinch-out → snap back to full
      else if (pinchScale.value < 1) {
        pinchScale.value = withTiming(1, { duration: 180 });
      }
    });

  // ------- PAN – swipe left/right to change page (full mode only) -------
  const pan = Gesture.Pan().onEnd((event) => {
    const dx = event.translationX;

    // 👉 swipe left → NEXT page
    if (dx < -60 && onPrevPage) {
      runOnJS(onPrevPage)();
    }
    // 👈 swipe right → PREVIOUS page
    else if (dx > 60 && onNextPage) {
      runOnJS(onNextPage)();
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

  const renderVerseBlocks = () => {
    const blocks: React.ReactNode[] = [];
    let inline: React.ReactNode[] = [];

    const flushInline = (key: string) => {
      if (inline.length === 0) return;
      blocks.push(
        <Text
          key={key}
          className="text-[24px] leading-[48px] text-justify text-[#1F1F1F]"
          style={{ fontFamily: FONTS.arabic, writingDirection: "rtl" }}
        >
          {inline}
        </Text>
      );
      inline = [];
    };

    page.verses.forEach((verse, index) => {
      if (verse.isStart) {
        flushInline(`block-${index}`);

        blocks.push(
          <View key={`surah-banner-${index}`} className="items-center my-2">
            <SurahBanner
              label={`سورة ${toArabicSurahName(verse.surah)}`}
              size="lg"
              textStyle={{ color: "#000000" }}
            />
          </View>
        );
      }

      inline.push(
        <React.Fragment key={`verse-${index}`}>
          {verse.text}
          <Text
            className="text-[18px] text-[#BF8C34]"
            style={{ fontFamily: FONTS.arabic }}
          >
            {" "}
            ﴿{toArabicNumber(verse.ayah)}﴾{" "}
          </Text>
        </React.Fragment>
      );
    });

    flushInline("block-final");

    return blocks;
  };

  return (
    <View className="flex-1 bg-[#FFFDF5]">
      {/* MAIN PAGE (scaled) */}
      <GestureDetector gesture={gesture}>
        <Pressable className="flex-1" onPress={handlePress}>
          <AnimatedView className="flex-1 items-center justify-center">
            <AnimatedView
              style={[
                { width, paddingTop: 60, paddingBottom: 30 },
                animatedStyle,
              ]}
              className="h-full justify-between"
            >
              {/* HEADER */}
              <View className="flex-row justify-between px-5 mb-2 items-center">
                <View className="px-3 py-1">
                  <Text
                    className="text-[18px] font-semibold text-[#1F1F1F]"
                    style={{ fontFamily: FONTS.arabic }}
                  >
                    سورة {surahName}
                  </Text>
                </View>
                <View className="px-3 py-1">
                  <Text
                    className="text-[18px] font-semibold text-[#1F1F1F]"
                    style={{ fontFamily: FONTS.arabic }}
                  >
                    الجزء {toArabicNumber(juzNumber)}
                  </Text>
                </View>
              </View>

              {/* CONTENT */}
              <View className="flex-1 px-6 justify-center">
                {renderVerseBlocks()}
              </View>

              {/* FOOTER */}
              <View className="items-center mb-2">
                <View className="w-10 h-10 items-center justify-center">
                  <Text
                    className="text-[16px] font-bold text-[#1F1F1F]"
                    style={{ fontFamily: FONTS.arabic }}
                  >
                    {toArabicNumber(page.pageNumber)}
                  </Text>
                </View>
              </View>
            </AnimatedView>
          </AnimatedView>
        </Pressable>
      </GestureDetector>

      {/* MINI MODE CONTROLS – OUTSIDE THE SCALED VIEW */}
      {/* MINI MODE CONTROLS – OUTSIDE THE SCALED VIEW */}
      {isMini && (
        <>
          {/* TOP AREA: search + surah slider (stick to top) */}
          <View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 40,
              alignItems: "center",
              zIndex: 50,
            }}
          >
            {/* SEARCH BAR (UI only for now) */}
            <View className="w-[90%] mb-3">
              <View className="flex-row-reverse items-center bg-[#F4EFE4] rounded-3xl px-4 py-2">
                <Text
                  className="flex-1 text-right text-[#999]"
                  style={{ fontFamily: FONTS.arabic }}
                >
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
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 40,
              alignItems: "center",
              zIndex: 50,
            }}
          >
            <View className="flex-row items-center bg-white/95 rounded-full px-4 py-2 gap-4 shadow">
              <Pressable
                disabled={!onNextPage}
                onPress={onNextPage}
                className="px-3 py-1"
              >
                <Text
                  className="text-[16px] text-[#2E8B57]"
                  style={{ fontFamily: FONTS.arabic }}
                >
                  التالي
                </Text>
              </Pressable>

              <Text
                className="text-[16px] text-[#1F1F1F]"
                style={{ fontFamily: FONTS.arabic }}
              >
                صفحة {toArabicNumber(page.pageNumber)}
              </Text>

              <Pressable
                disabled={!onPrevPage}
                onPress={onPrevPage}
                className="px-3 py-1"
              >
                <Text
                  className="text-[16px] text-[#2E8B57]"
                  style={{ fontFamily: FONTS.arabic }}
                >
                  السابق
                </Text>
              </Pressable>
            </View>

            <Text
              className="mt-2 text-[12px] text-[#666]"
              style={{ fontFamily: FONTS.arabic }}
            >
              اضغط ضغطتين في أي مكان للتبديل بين وضع القراءة والوضع المصغّر
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

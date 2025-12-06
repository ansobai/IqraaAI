// components/QuranPageView.tsx
import React, { useEffect, useRef, useState } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";
import { FONTS } from "../constants/theme";
import { ReadyPage } from "../utils/quranProcessor";

import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { toArabicNumber } from "../utils/toArabicNumbers";

const { width } = Dimensions.get("window");
const AnimatedView = Animated.createAnimatedComponent(View);

interface Props {
  page: ReadyPage;
  onNextPage?: () => void;
  onPrevPage?: () => void;
}

export default function QuranPageView({ page, onNextPage, onPrevPage }: Props) {
  if (!page || !page.verses || page.verses.length === 0) return null;

  const firstVerse = page.verses[0];
  const surahName = firstVerse.surah;
  const juzNumber = Math.ceil(page.pageNumber / 20);

  // ------- MODE: full vs mini -------
  const [isMini, setIsMini] = useState(false);

  const baseScale = useSharedValue(1);
  const pinchScale = useSharedValue(1);

  useEffect(() => {
    if (isMini) {
      baseScale.value = withTiming(0.55, { duration: 220 });
      pinchScale.value = 1;
    } else {
      baseScale.value = withTiming(1, { duration: 220 });
    }
  }, [isMini, baseScale, pinchScale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: baseScale.value * pinchScale.value }],
  }));

  // ------- PINCH (zoom) – only in full mode -------
  const pinch = Gesture.Pinch()
    .enabled(!isMini)
    .onUpdate((event) => {
      let next = event.scale;
      if (next < 0.8) next = 0.8;
      if (next > 3) next = 3;
      pinchScale.value = next;
    })
    .onEnd(() => {
      if (pinchScale.value < 1) {
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

  return (
    <View className="flex-1 bg-[#FFFDF5]">
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
              <View className="flex-row justify-between px-5 mb-2">
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
                <Text
                  className="text-[24px] leading-[48px] text-justify text-[#1F1F1F]"
                  style={{
                    fontFamily: FONTS.arabic,
                    writingDirection: "rtl",
                  }}
                >
                  {page.verses.map((verse, index) => (
                    <React.Fragment key={index}>
                      {verse.isStart && (
                        <Text
                          className="text-[22px] font-bold text-center text-[#2E8B57] my-2"
                          style={{ fontFamily: FONTS.arabic }}
                        >
                          {"\n"}سورة {verse.surah}
                          {"\n"}
                        </Text>
                      )}

                      {verse.isStart && !verse.isFatihaOrTawbah && (
                        <Text
                          className="text-[20px] text-center text-[#1F1F1F] my-1"
                          style={{ fontFamily: FONTS.arabic }}
                        >
                          {"\n"}بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ{"\n"}
                        </Text>
                      )}

                      <Text>
                        {verse.text}
                        <Text
                          className="text-[18px] text-[#BF8C34]"
                          style={{ fontFamily: FONTS.arabic }}
                        >
                          {" "}
                          ﴿{toArabicNumber(verse.ayah)}﴾{" "}
                        </Text>
                      </Text>
                    </React.Fragment>
                  ))}
                </Text>
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

            {/* MINI MODE CONTROLS OVERLAY */}
            {isMini && (
              <View className="absolute bottom-10 inset-x-0 items-center">
                <View className="flex-row items-center bg-white/95 rounded-full px-4 py-2 gap-4 shadow">
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

                  <Text
                    className="text-[16px] text-[#1F1F1F]"
                    style={{ fontFamily: FONTS.arabic }}
                  >
                    صفحة {toArabicNumber(page.pageNumber)}
                  </Text>

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
                </View>

                <Text
                  className="mt-2 text-[12px] text-[#666]"
                  style={{ fontFamily: FONTS.arabic }}
                >
                  اضغط ضغطتين في أي مكان للتبديل بين وضع القراءة والوضع المصغّر
                </Text>
              </View>
            )}
          </AnimatedView>
        </Pressable>
      </GestureDetector>
    </View>
  );
}

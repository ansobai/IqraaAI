import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Image, Text, View } from "react-native";

import { LAST_READ_PAGE_KEY } from "../constants/storage";
import { getSurahIdForPageNumber } from "../utils/mushafData";
import { prefetchQuranPageSvgs } from "../utils/quranSvgRegistry";

const HOME_HOLD_MS = 3000;
const PREFETCH_WINDOW = 4;
const FALLBACK_SURAH_ID = 1;
const FALLBACK_PAGE_NUMBER = 1;

type LaunchTarget = {
  surahId: number;
  pageNumber: number;
};

const buildPrefetchPages = (pageNumber: number) => {
  const nearby = Array.from(
    { length: PREFETCH_WINDOW * 2 + 1 },
    (_, offset) => pageNumber - PREFETCH_WINDOW + offset,
  );
  return Array.from(new Set([1, 2, 3, 4, 5, 6, ...nearby]));
};

export default function HomeScreen() {
  const router = useRouter();
  const targetRef = useRef<LaunchTarget>({
    surahId: FALLBACK_SURAH_ID,
    pageNumber: FALLBACK_PAGE_NUMBER,
  });
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let isActive = true;
    let cancelPrefetch = () => {};

    progress.setValue(0);
    const progressAnimation = Animated.timing(progress, {
      toValue: 1,
      duration: HOME_HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    progressAnimation.start();

    const launchTimer = setTimeout(() => {
      if (!isActive) return;
      const nextTarget = targetRef.current;
      router.replace({
        pathname: "/[surahId]",
        params: {
          surahId: String(nextTarget.surahId),
          page: String(nextTarget.pageNumber),
        },
      });
    }, HOME_HOLD_MS);

    const bootstrap = async () => {
      let resolvedTarget: LaunchTarget = {
        surahId: FALLBACK_SURAH_ID,
        pageNumber: FALLBACK_PAGE_NUMBER,
      };

      try {
        const saved = await AsyncStorage.getItem(LAST_READ_PAGE_KEY);
        const savedNumber = saved ? Number(saved) : NaN;
        const pageNumber = Number.isFinite(savedNumber) ? savedNumber : 1;
        const surahId = getSurahIdForPageNumber(pageNumber);
        const safeSurahId =
          Number.isFinite(surahId) && surahId > 0 ? surahId : FALLBACK_SURAH_ID;

        resolvedTarget = {
          surahId: safeSurahId,
          pageNumber: pageNumber > 0 ? pageNumber : FALLBACK_PAGE_NUMBER,
        };
      } catch {
        resolvedTarget = {
          surahId: FALLBACK_SURAH_ID,
          pageNumber: FALLBACK_PAGE_NUMBER,
        };
      }

      if (!isActive) return;
      targetRef.current = resolvedTarget;

      cancelPrefetch = prefetchQuranPageSvgs(
        buildPrefetchPages(resolvedTarget.pageNumber),
        { chunkSize: 6, staggerMs: 8 },
      );
    };

    void bootstrap();

    return () => {
      isActive = false;
      clearTimeout(launchTimer);
      progressAnimation.stop();
      cancelPrefetch();
    };
  }, [progress, router]);

  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View className="flex-1 bg-[#FFFDF5]">
      <Stack.Screen options={{ headerShown: false }} />

      <View className="absolute -top-24 -right-14 w-72 h-72 rounded-full bg-[#E7F4EE]" />
      <View className="absolute -bottom-16 -left-12 w-64 h-64 rounded-full bg-[#F2ECDD]" />

      <View className="flex-1 items-center justify-center px-8">
        <Image
          source={require("../assets/images/icon.png")}
          className="w-36 h-36 mb-4"
          resizeMode="contain"
        />
        <Text
          className="text-5xl text-[#1F1F1F] mb-2 font-semibold"
          style={{ lineHeight: 64 }}
        >
          Iqraa
        </Text>
        <Text className="text-base text-[#5F5A4F] text-center mb-7">
          Preparing your reading session
        </Text>

        <View className="w-full max-w-[360px] bg-white border border-[#E8E1D1] rounded-3xl px-6 py-8 items-center shadow-sm">
          <View className="w-full h-1.5 rounded-full bg-[#E9E1D4] overflow-hidden">
            <Animated.View
              style={{
                width: progressWidth,
                height: "100%",
                backgroundColor: "#2E8B57",
              }}
            />
          </View>
        </View>
      </View>

      <Text className="absolute bottom-14 self-center text-2xl font-amiri text-[#8F7E5E]">
        اقرا بسم ربك اللذي خلق
      </Text>
    </View>
  );
}

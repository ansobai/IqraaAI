// app/index.tsx
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    Text,
    TextInput,
    View,
} from "react-native";
import SurahBanner from "../components/SurahBanner";
import { LAST_READ_PAGE_KEY } from "../constants/storage";
import { ARABIC_SURAHS } from "../constants/surahNames";
import { getSurahIdForPageNumber } from "../utils/mushafData";
import { toArabicNumber } from "../utils/toArabicNumbers";

interface SurahItem {
  id: number;
  name: string;
}

// Surahs shown in the slider
const SURAHS = ARABIC_SURAHS.map((name, i) => ({ id: i, name }));

export default function Dashboard() {
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(true);

  useEffect(() => {
    let isActive = true;

    const redirectToLastPage = async () => {
      try {
        const saved = await AsyncStorage.getItem(LAST_READ_PAGE_KEY);
        const savedNumber = saved ? Number(saved) : NaN;
        const pageNumber = Number.isFinite(savedNumber) ? savedNumber : 1;
        const surahId = getSurahIdForPageNumber(pageNumber);

        if (isActive) {
          router.replace(`/(surahs)/${surahId}`);
        }
      } catch {
        if (isActive) {
          router.replace("/(surahs)/1");
          setIsRedirecting(false);
        }
      }
    };

    redirectToLastPage();

    return () => {
      isActive = false;
    };
  }, [router]);

  if (isRedirecting) {
    return (
      <View className="flex-1 bg-[#FFFDF5] items-center justify-center">
        <ActivityIndicator size="small" color="#2E8B57" />
      </View>
    );
  }

  const handleNavigation = (id: number) => {
    console.log("Navigating to Surah:", id);
    router.push(`/(surahs)/${id}`);
  };

  return (
    <View className="flex-1 bg-[#FFFDF5] pt-12">
      <Stack.Screen options={{ headerShown: false }} />

      {/* TOP BAR */}
      <View className="flex-row-reverse items-center justify-between px-5 mb-5">
        <Pressable
          style={({ pressed }) => ({
            transform: [{ scale: pressed ? 0.9 : 1 }],
          })}
        >
          <Ionicons name="menu" size={28} color="#1F1F1F" />
        </Pressable>

        <View className="flex-1 flex-row-reverse bg-[#F0EBE0] rounded-2xl px-4 py-2 mr-4 items-center gap-2">
          <Ionicons name="search" size={20} color="#999" />
          <TextInput
            placeholder="بحث في السور..."
            placeholderTextColor="#999"
            className="flex-1 text-right text-base text-[#1F1F1F] font-uthmanic"
          />
        </View>
      </View>

      {/* SURAH SLIDER */}
      <View className="h-16">
        <FlatList
          data={SURAHS.filter((s) => s.id !== 0)}
          keyExtractor={(item) => item.id.toString()}
          horizontal
          showsHorizontalScrollIndicator={false}
          inverted
          contentContainerClassName="px-5 items-center"
          renderItem={({ item: s, index }) => {
            const isActive = index === 0;
            return (
              <Pressable
                onPress={() => handleNavigation(s.id)}
                style={({ pressed }) => [
                  {
                    transform: [{ scale: pressed ? 0.95 : 1 }],
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
                className="ml-3"
              >
                <SurahBanner
                  label={s.name}
                  size="md"
                  textStyle={{ color: isActive ? "#2E8B57" : "#1F1F1F" }}
                />
              </Pressable>
            );
          }}
        />
      </View>

      {/* CENTER CARD */}
      <View className="flex-1 justify-center items-center">
        <Text
          className="text-xl text-[#1F1F1F] mb-5 font-bold font-uthmanic"
        >
          تابع القراءة
        </Text>

        <Pressable
          onPress={() => handleNavigation(1)}
          style={({ pressed }) => [
            {
              transform: [{ scale: pressed ? 0.96 : 1 }],
              opacity: pressed ? 0.9 : 1,
            },
          ]}
          className="w-[60%] aspect-[9/16] bg-white rounded-2xl shadow-sm border border-[#E8E1D1] p-4 justify-between"
        >
          <View className="flex-1 border-2 border-[#8F7E5E] p-2 items-center justify-between">
            <SurahBanner label={ARABIC_SURAHS[1]} size="sm" />

            <View className="w-full items-center gap-2">
              <View className="h-[2px] w-[90%] bg-gray-200 rounded-full" />
              <View className="h-[2px] w-[90%] bg-gray-200 rounded-full" />
              <View className="h-[2px] w-[90%] bg-gray-200 rounded-full" />
              <View className="h-[2px] w-[60%] bg-gray-200 rounded-full" />
            </View>

            <Text
              className="text-xs text-[#8F7E5E] font-uthmanic"
            >
              {toArabicNumber(1)}
            </Text>
          </View>
        </Pressable>
      </View>

      {/* BOTTOM BAR */}
      <View className="flex-row-reverse justify-between px-10 pb-10 pt-5 border-t border-[#F0EBE0]">
        <View className="items-center gap-1">
          <Ionicons name="moon-outline" size={24} color="#1F1F1F" />
          <Text
            className="text-xs text-[#1F1F1F] font-uthmanic"
          >
            المظهر
          </Text>
        </View>

        <View className="items-center gap-1">
          <Ionicons name="book-outline" size={24} color="#1F1F1F" />
          <Text
            className="text-xs text-[#1F1F1F] font-uthmanic"
          >
            الجزء {toArabicNumber(1)}
          </Text>
        </View>
      </View>
    </View>
  );
}

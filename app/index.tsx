// app/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import React from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { ARABIC_SURAHS } from "../constants/surahNames";
import { toArabicNumber } from "../utils/toArabicNumbers";

interface SurahItem {
  id: number;
  name: string;
}

// Surahs shown in the slider
const SURAHS = ARABIC_SURAHS.map((name, i) => ({ id: i, name }));

export default function Dashboard() {
  const router = useRouter();

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
            className="flex-1 text-right text-base text-[#1F1F1F]"
            style={{ fontFamily: "Amiri" }}
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
          contentContainerStyle={{
            paddingHorizontal: 20,
            alignItems: "center",
          }}
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
                className={`px-5 py-2 rounded-full ml-3 ${
                  isActive ? "bg-[#2E8B57]" : "bg-[#F0EBE0]"
                }`}
              >
                <Text
                  className={`text-base ${
                    isActive ? "text-white font-bold" : "text-[#1F1F1F]"
                  }`}
                  style={{ fontFamily: "Amiri" }}
                >
                  {s.name}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {/* CENTER CARD */}
      <View className="flex-1 justify-center items-center">
        <Text
          className="text-xl text-[#1F1F1F] mb-5 font-bold"
          style={{ fontFamily: "Amiri" }}
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
            <Text
              className="text-sm text-[#1F1F1F]"
              style={{ fontFamily: "Amiri" }}
            >
              {ARABIC_SURAHS[1]}
            </Text>

            <View className="w-full items-center gap-2">
              <View className="h-[2px] w-[90%] bg-gray-200 rounded-full" />
              <View className="h-[2px] w-[90%] bg-gray-200 rounded-full" />
              <View className="h-[2px] w-[90%] bg-gray-200 rounded-full" />
              <View className="h-[2px] w-[60%] bg-gray-200 rounded-full" />
            </View>

            <Text
              className="text-xs text-[#8F7E5E]"
              style={{ fontFamily: "Amiri" }}
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
            className="text-xs text-[#1F1F1F]"
            style={{ fontFamily: "Amiri" }}
          >
            المظهر
          </Text>
        </View>

        <View className="items-center gap-1">
          <Ionicons name="book-outline" size={24} color="#1F1F1F" />
          <Text
            className="text-xs text-[#1F1F1F]"
            style={{ fontFamily: "Amiri" }}
          >
            الجزء {toArabicNumber(1)}
          </Text>
        </View>
      </View>
    </View>
  );
}

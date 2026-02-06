// app/index.tsx
import { useAuth } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import SurahBanner from "../components/SurahBanner";
import { LAST_READ_PAGE_KEY } from "../constants/storage";
import { ARABIC_SURAHS } from "../constants/surahNames";
import { useQuranSearch } from "../hooks/useQuranSearch";
import { getSurahIdForPageNumber } from "../utils/mushafData";
import { SearchResult } from "../utils/searchUtils";
import { toArabicNumber } from "../utils/toArabicNumbers";

// Surahs shown in the slider
const SURAHS = ARABIC_SURAHS.map((name, i) => ({ id: i, name }));

export default function Dashboard() {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(true);
  const { query, setQuery, results, isSearching } = useQuranSearch();

  const handleSearchResultPress = (result: SearchResult) => {
    if (result.type === "surah") {
      router.push(`/${result.id}`);
    } else {
      router.push(`/${result.surahId}?page=${result.pageNumber}`);
    }
  };

  useEffect(() => {
    let isActive = true;

    const redirectToLastPage = async () => {
      try {
        const saved = await AsyncStorage.getItem(LAST_READ_PAGE_KEY);
        const savedNumber = saved ? Number(saved) : NaN;
        const pageNumber = Number.isFinite(savedNumber) ? savedNumber : 1;
        const surahId = getSurahIdForPageNumber(pageNumber);

        if (isActive) {
          router.replace(`/${surahId}`);
        }
      } catch {
        if (isActive) {
          router.replace("/1");
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
    router.push(`/${id}`);
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View className="flex-1 bg-[#FFFDF5] pt-12">
        <Stack.Screen options={{ headerShown: false }} />

        {/* TOP BAR */}
        <View className="flex-row-reverse items-center justify-between px-5 mb-5 z-20">
          <Pressable
            onPress={() => {
              const actions = [];
              if (isLoaded && isSignedIn) {
                actions.push({
                  text: "Sign out",
                  style: "destructive" as const,
                  onPress: () => void signOut(),
                });
              } else {
                actions.push({
                  text: "Sign in",
                  onPress: () => router.push("/(auth)/sign-in"),
                });
              }

              Alert.alert("Menu", undefined, [
                ...actions,
                { text: "Cancel", style: "cancel" },
              ]);
            }}
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
              value={query}
              onChangeText={setQuery}
            />
          </View>
        </View>

        {/* SEARCH RESULTS OVERLAY */}
        {query.length > 0 && (
          <View className="absolute top-28 left-5 right-5 bottom-10 bg-white rounded-2xl shadow-lg z-50 border border-[#E8E1D1] overflow-hidden">
            {isSearching ? (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator color="#2E8B57" />
              </View>
            ) : results.length === 0 ? (
              <View className="flex-1 items-center justify-center p-5">
                <Text className="text-[#1F1F1F] font-uthmanic text-lg">
                  لا توجد نتائج
                </Text>
              </View>
            ) : (
              <FlatList
                data={results}
                keyExtractor={(item, index) => index.toString()}
                contentContainerClassName="py-2"
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => handleSearchResultPress(item)}
                    className="px-4 py-3 border-b border-[#F0EBE0] flex-row-reverse items-center justify-between active:bg-[#F9F9F9]"
                  >
                    {item.type === "surah" ? (
                      <View className="flex-row-reverse items-center gap-3">
                        <View className="w-8 h-8 rounded-full bg-[#E8E1D1] items-center justify-center">
                          <Text className="text-[#8F7E5E] font-bold text-xs">
                            {toArabicNumber(item.id)}
                          </Text>
                        </View>
                        <Text className="text-lg text-[#1F1F1F] font-uthmanic font-bold">
                          سورة {item.name}
                        </Text>
                      </View>
                    ) : (
                      <View className="flex-1">
                        <View className="flex-row-reverse items-center gap-2 mb-1">
                          <Text className="text-sm text-[#2E8B57] font-bold font-uthmanic">
                            سورة {item.surahName}
                          </Text>
                          <Text className="text-xs text-[#999] font-uthmanic">
                            آية {toArabicNumber(Number(item.verseNumber))}
                          </Text>
                        </View>
                        <Text
                          className="text-base text-[#1F1F1F] font-uthmanic text-right"
                          numberOfLines={1}
                        >
                          {item.text}
                        </Text>
                      </View>
                    )}
                    <Ionicons name="chevron-back" size={16} color="#CCC" />
                  </Pressable>
                )}
              />
            )}
          </View>
        )}

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
          <Text className="text-xl text-[#1F1F1F] mb-5 font-bold font-uthmanic">
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

              <Text className="text-xs text-[#8F7E5E] font-uthmanic">
                {toArabicNumber(1)}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* BOTTOM BAR */}
        <View className="flex-row-reverse justify-between px-10 pb-10 pt-5 border-t border-[#F0EBE0]">
          <View className="items-center gap-1">
            <Ionicons name="moon-outline" size={24} color="#1F1F1F" />
            <Text className="text-xs text-[#1F1F1F] font-uthmanic">المظهر</Text>
          </View>

          <View className="items-center gap-1">
            <Ionicons name="book-outline" size={24} color="#1F1F1F" />
            <Text className="text-xs text-[#1F1F1F] font-uthmanic">
              الجزء {toArabicNumber(1)}
            </Text>
          </View>
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { Text, View } from "react-native";

import { LAST_READ_PAGE_KEY } from "../constants/storage";
import { getSurahIdForPageNumber } from "../utils/mushafData";

const MIN_PAGE_NUMBER = 1;
const MAX_PAGE_NUMBER = 604;

export default function Dashboard() {
  const router = useRouter();

  useEffect(() => {
    let isActive = true;

    const redirectToLastPage = async () => {
      try {
        const saved = await AsyncStorage.getItem(LAST_READ_PAGE_KEY);
        const savedNumber = saved ? Number(saved) : NaN;
        const pageNumber =
          Number.isFinite(savedNumber) &&
          savedNumber >= MIN_PAGE_NUMBER &&
          savedNumber <= MAX_PAGE_NUMBER
            ? Math.floor(savedNumber)
            : MIN_PAGE_NUMBER;
        const surahId = getSurahIdForPageNumber(pageNumber);

        if (isActive) {
          router.replace(`/${surahId}?page=${pageNumber}`);
        }
      } catch {
        if (isActive) {
          router.replace("/1?page=1");
        }
      }
    };

    void redirectToLastPage();

    return () => {
      isActive = false;
    };
  }, [router]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#FFFDF5",
      }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={{ fontSize: 24, fontWeight: "600", color: "#1F1F1F" }}>
        TODO
      </Text>
    </View>
  );
}

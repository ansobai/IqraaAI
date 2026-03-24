// app/_layout.tsx
import { ClerkLoaded, ClerkProvider } from "@clerk/clerk-expo";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SecureStore from "expo-secure-store";
import { ActivityIndicator, Text } from "react-native";
import { warmupQuranSvgAssetsInBackground } from "../utils/quranSvgRegistry";

SplashScreen.preventAutoHideAsync();
const STARTUP_LOADING_MS = 3000;

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

const tokenCache = {
  async getToken(key: string) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // no-op
    }
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    UthmanicHafs: require("../assets/fonts/ArbFONTS-Hafs-Font-v0.09.otf"),
    Madani: require("../assets/fonts/KFGQPC Uthmanic Script HAFS Regular.otf"),
    // Fallback aliases until dedicated Scheherazade/Amiri files are added.
    Scheherazade: require("../assets/fonts/KFGQPC Uthmanic Script HAFS Regular.otf"),
    Amiri: require("../assets/fonts/ArbFONTS-Hafs-Font-v0.09.otf"),
  });
  const [showStartupLoader, setShowStartupLoader] = useState(true);

  useEffect(() => {
    if (!loaded && !error) return;

    let isActive = true;
    void SplashScreen.hideAsync();
    void warmupQuranSvgAssetsInBackground();

    const timer = setTimeout(() => {
      if (isActive) {
        setShowStartupLoader(false);
      }
    }, STARTUP_LOADING_MS);

    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [loaded, error]);

  if (!loaded && !error) {
    return null;
  }

  if (showStartupLoader) {
    return (
      <GestureHandlerRootView className="flex-1 items-center justify-center bg-[#FFFDF5]">
        <ActivityIndicator size="large" color="#2E8B57" />
        <Text className="mt-4 text-base text-[#1F1F1F]">Loading Quran pages...</Text>
      </GestureHandlerRootView>
    );
  }

  if (!publishableKey) {
    return (
      <GestureHandlerRootView className="flex-1 items-center justify-center bg-[#FFFDF5] px-6">
        <Text className="text-base text-center text-[#1F1F1F]">
          Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Copy .env.example to .env
          and set your Clerk publishable key.
        </Text>
      </GestureHandlerRootView>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkLoaded>
        <GestureHandlerRootView className="flex-1">
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#FFFDF5" },
            }}
          />
        </GestureHandlerRootView>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

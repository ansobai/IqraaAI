// app/_layout.tsx
import { ClerkLoaded, ClerkProvider } from "@clerk/clerk-expo";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SecureStore from "expo-secure-store";
import { ActivityIndicator, Text, View } from "react-native";

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
    Scheherazade: require("../assets/fonts/ScheherazadeNew-Regular.ttf"),
    Amiri: require("../assets/fonts/Amiri-Regular.ttf"),
  });
  const [showStartupLoader, setShowStartupLoader] = useState(true);

  useEffect(() => {
    if (!loaded && !error) return;

    let isActive = true;
    void SplashScreen.hideAsync();

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
          {showStartupLoader ? (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#FFFDF5",
              }}
            >
              <ActivityIndicator size="large" color="#2E8B57" />
              <Text className="mt-4 text-base text-[#1F1F1F]">
                Loading Quran pages...
              </Text>
            </View>
          ) : null}
        </GestureHandlerRootView>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

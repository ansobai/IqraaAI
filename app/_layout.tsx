// app/_layout.tsx
import { ClerkLoaded, ClerkProvider } from "@clerk/clerk-expo";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SecureStore from "expo-secure-store";
import { Text } from "react-native";

SplashScreen.preventAutoHideAsync();

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

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
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
        </GestureHandlerRootView>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

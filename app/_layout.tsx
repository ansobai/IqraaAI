// app/_layout.tsx
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

SplashScreen.preventAutoHideAsync();

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

  return (
    <GestureHandlerRootView className="flex-1">
      <Stack />
    </GestureHandlerRootView>
  );
}

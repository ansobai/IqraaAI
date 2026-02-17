import { Stack, useRouter } from "expo-router";
import React from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import AuthScreen from "../../components/Auth/AuthScreen";

export default function SignUpScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-[#FFFDF5]" edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <AuthScreen initialTab="signUp" onBack={() => router.back()} />
    </SafeAreaView>
  );
}

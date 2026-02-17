import { Stack, useRouter } from "expo-router";
import React from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import AuthScreen from "../../components/Auth/AuthScreen";

export default function SignInScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-[#FFFDF5]" edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/*
        Single screen UI that toggles Sign In / Sign Up.
        We keep `sign-in` and `sign-up` routes as entry points.
      */}
      <AuthScreen initialTab="signIn" onBack={() => router.back()} />
    </SafeAreaView>
  );
}

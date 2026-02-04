import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const PRIMARY = "#A7D4DA";
const TEXT = "#1F1F1F";

export default function SignUpScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const contentWidth = useMemo(() => Math.min(420, Math.max(320, width - 40)), [width]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordHidden, setIsPasswordHidden] = useState(true);

  return (
    <SafeAreaView className="flex-1 bg-[#FFFDF5]" edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={{
          alignItems: "center",
          paddingHorizontal: 20,
          paddingBottom: 32,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full" style={{ maxWidth: contentWidth }}>
          <View className="pt-4 pb-2">
            <View className="flex-row items-center">
              <Pressable
                onPress={() => router.back()}
                className="w-10 h-10 items-center justify-center"
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Ionicons name="chevron-back" size={26} color={TEXT} />
              </Pressable>
              <View className="flex-1 items-center" pointerEvents="none">
                <Text className="text-xl font-semibold text-[#1F1F1F]">
                  Create Account
                </Text>
              </View>
              <View className="w-10 h-10" />
            </View>
          </View>

          <View className="pt-8 items-center">
            <View
              className="w-28 h-28 rounded-full items-center justify-center"
              style={{ backgroundColor: "#ECF7FA" }}
            >
              <Ionicons name="book-outline" size={46} color={PRIMARY} />
            </View>
          </View>

          <View className="pt-6 items-center">
            <Text className="text-4xl font-bold text-[#1F1F1F] text-center">
              Join Our Community
            </Text>
            <Text className="text-lg mt-3 text-[#7B8794] text-center">
              Begin your spiritual journey and track your progress daily.
            </Text>
          </View>

          <View className="mt-10 border-b border-[#E8E1D1] flex-row">
            <Pressable
              onPress={() => router.replace("/(auth)/sign-in")}
              className="flex-1 items-center pb-3"
              accessibilityRole="button"
              accessibilityLabel="Sign in tab"
            >
              <Text className="text-base font-semibold text-[#97A6B2]">Sign In</Text>
              <View className="mt-3 h-1 rounded-full" style={{ width: 44, backgroundColor: "transparent" }} />
            </Pressable>
            <Pressable
              onPress={() => {}}
              className="flex-1 items-center pb-3"
              accessibilityRole="button"
              accessibilityLabel="Sign up tab"
            >
              <Text className="text-base font-semibold text-[#1F1F1F]">Sign Up</Text>
              <View className="mt-3 h-1 rounded-full" style={{ width: 44, backgroundColor: PRIMARY }} />
            </Pressable>
          </View>

          <View className="mt-8 flex-row gap-4">
            <View className="flex-1">
              <View className="flex-row justify-between mb-3">
                <Text className="text-base text-[#1F1F1F] font-medium">First Name</Text>
                <Text className="text-base text-[#97A6B2]">الاسم الأول</Text>
              </View>
              <View className="bg-white border border-[#E8E1D1] rounded-3xl px-5 py-4">
                <TextInput
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First Name"
                  placeholderTextColor="#B0BAC5"
                  className="text-base text-[#1F1F1F]"
                />
              </View>
            </View>

            <View className="flex-1">
              <View className="flex-row justify-between mb-3">
                <Text className="text-base text-[#1F1F1F] font-medium">Last Name</Text>
                <Text className="text-base text-[#97A6B2]">اسم العائلة</Text>
              </View>
              <View className="bg-white border border-[#E8E1D1] rounded-3xl px-5 py-4">
                <TextInput
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last Name"
                  placeholderTextColor="#B0BAC5"
                  className="text-base text-[#1F1F1F]"
                />
              </View>
            </View>
          </View>

          <View className="mt-6">
            <View className="flex-row justify-between mb-3">
              <Text className="text-base text-[#1F1F1F] font-medium">Email Address</Text>
              <Text className="text-base text-[#97A6B2]">البريد الإلكتروني</Text>
            </View>
            <View className="bg-white border border-[#E8E1D1] rounded-3xl px-5 py-4">
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="example@email.com"
                placeholderTextColor="#B0BAC5"
                autoCapitalize="none"
                keyboardType="email-address"
                className="text-base text-[#1F1F1F]"
              />
            </View>
          </View>

          <View className="mt-6">
            <View className="flex-row justify-between mb-3">
              <Text className="text-base text-[#1F1F1F] font-medium">Password</Text>
              <Text className="text-base text-[#97A6B2]">كلمة المرور</Text>
            </View>
            <View className="bg-white border border-[#E8E1D1] rounded-3xl px-5 py-4 flex-row items-center">
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor="#B0BAC5"
                secureTextEntry={isPasswordHidden}
                className="flex-1 text-base text-[#1F1F1F]"
              />
              <Pressable
                onPress={() => setIsPasswordHidden((v) => !v)}
                className="pl-4"
                accessibilityRole="button"
                accessibilityLabel={isPasswordHidden ? "Show password" : "Hide password"}
              >
                <Ionicons name={isPasswordHidden ? "eye-outline" : "eye-off-outline"} size={22} color="#6B7C8A" />
              </Pressable>
            </View>
          </View>

          <Pressable
            onPress={() => {}}
            className="mt-8 rounded-full items-center justify-center"
            style={{
              backgroundColor: PRIMARY,
              paddingVertical: 18,
              shadowColor: "#000",
              shadowOpacity: 0.08,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 8 },
              elevation: 4,
            }}
            accessibilityRole="button"
            accessibilityLabel="Create account"
          >
            <Text className="text-white text-xl font-semibold">Create Account</Text>
          </Pressable>

          <View className="mt-10 flex-row items-center justify-center">
            <View className="flex-1 h-px bg-[#E8E1D1]" />
            <Text className="mx-4 text-base text-[#97A6B2]">OR</Text>
            <View className="flex-1 h-px bg-[#E8E1D1]" />
          </View>

          <Pressable
            onPress={() => {}}
            className="mt-6 bg-white border border-[#E8E1D1] rounded-3xl px-5 py-4 flex-row items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel="Sign up with Google"
          >
            <View
              className="w-8 h-8 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: "#F2F3F5" }}
            >
              <Text className="text-base font-bold">G</Text>
            </View>
            <Text className="text-lg font-semibold text-[#1F1F1F]">Sign up with Google</Text>
          </Pressable>

          <View className="mt-8 items-center">
            <Text className="text-sm text-[#97A6B2] text-center">
              By signing up, you agree to our{" "}
              <Text style={{ color: PRIMARY }} className="font-semibold">
                Terms of Service
              </Text>{" "}
              and{" "}
              <Text style={{ color: PRIMARY }} className="font-semibold">
                Privacy Policy
              </Text>
              .
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

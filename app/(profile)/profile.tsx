import { useAuth, useUser } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { Stack, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Profile } from "../../types/Profile";
import { createProfileIfMissing, fetchProfile } from "../../utils/profileApi";
import { useAuthedFetch } from "../../utils/apiClient";

const PRIMARY = "#A7D4DA";
const TEXT = "#1F1F1F";
const MUTED = "#7B8794";
const BG = "#FFFDF5";
const DEFAULT_AVATAR = require("../../assets/images/default-avatar.jpg");

function InfoRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="bg-white border border-[#E8E1D1] rounded-2xl px-4 py-4 flex-row items-center"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        className="w-10 h-10 rounded-xl items-center justify-center mr-4"
        style={{ backgroundColor: "#EFF6F7" }}
      >
        <Ionicons name={icon} size={20} color={PRIMARY} />
      </View>

      <View className="flex-1">
        <Text className="text-xs tracking-wider text-[#97A6B2] font-semibold">
          {label.toUpperCase()}
        </Text>
        <Text className="text-lg text-[#1F1F1F] font-semibold mt-1">
          {value}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={18} color="#97A6B2" />
    </Pressable>
  );
}

function SettingsRow({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="bg-white border border-[#E8E1D1] rounded-2xl px-4 py-4 flex-row items-center"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        className="w-10 h-10 rounded-xl items-center justify-center mr-4"
        style={{ backgroundColor: "#EFF6F7" }}
      >
        <Ionicons name={icon} size={20} color={PRIMARY} />
      </View>

      <Text className="text-lg text-[#1F1F1F] font-semibold flex-1">
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={18} color="#97A6B2" />
    </Pressable>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: 40 }}>
      <Text
        className="text-xl font-bold text-[#1F1F1F]"
        style={{
          marginBottom: 16,
          zIndex: 2,
          backgroundColor: BG,
        }}
      >
        {title}
      </Text>
      <View style={{ zIndex: 1, rowGap: 16 }}>{children}</View>
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const contentWidth = useMemo(
    () => Math.min(420, Math.max(320, width - 40)),
    [width],
  );

  const authedFetch = useAuthedFetch();
  const { isLoaded: isAuthLoaded, isSignedIn, signOut } = useAuth();
  const { isLoaded: isUserLoaded, user } = useUser();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const userId = user?.id ?? null;
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null;

  const refreshProfile = useCallback(async () => {
    if (!isAuthLoaded || !isUserLoaded) return;

    setProfileError(null);

    if (!isSignedIn || !userId || !userEmail || !authedFetch) {
      setProfile(null);
      return;
    }

    setIsLoadingProfile(true);
    try {
      const existing = await fetchProfile(authedFetch);
      if (existing) {
        setProfile(existing);
        return;
      }

      const created = await createProfileIfMissing(authedFetch, {
        email: userEmail,
        firstName: user?.firstName,
        lastName: user?.lastName,
      });
      setProfile(created);
    } catch (error) {
      console.error("Failed to load profile:", error);
      setProfileError("Failed to load profile. Please try again.");
      setProfile(null);
    } finally {
      setIsLoadingProfile(false);
    }
  }, [
    isAuthLoaded,
    isSignedIn,
    isUserLoaded,
    authedFetch,
    user?.firstName,
    user?.lastName,
    userEmail,
    userId,
  ]);

  useFocusEffect(
    useCallback(() => {
      void refreshProfile();
    }, [refreshProfile]),
  );

  const avatarSource = useMemo(() => {
    if (isSignedIn && user?.imageUrl) return { uri: user.imageUrl };
    return DEFAULT_AVATAR;
  }, [isSignedIn, user?.imageUrl]);

  const displayName = useMemo(() => {
    const first = (profile?.first_name ?? user?.firstName ?? "").trim();
    const last = (profile?.last_name ?? user?.lastName ?? "").trim();
    const combined = `${first} ${last}`.trim();
    return combined.length > 0 ? combined : "Your Name";
  }, [profile?.first_name, profile?.last_name, user?.firstName, user?.lastName]);

  const displayEmail = useMemo(() => {
    if (userEmail) return userEmail;
    if (profile?.email) return profile.email;
    return "Sign in to view your email";
  }, [profile?.email, userEmail]);

  const onEditProfile = () => {
    if (!isSignedIn) {
      router.push("/(auth)/sign-in");
      return;
    }
    router.push("/(profile)/edit-profile");
  };

  const onLogoutOrSignIn = async () => {
    if (!isSignedIn) {
      router.push("/(auth)/sign-in");
      return;
    }
    try {
      await signOut();
    } catch (error) {
      Alert.alert("Error", "Could not sign out. Please try again.");
      console.error(error);
    }
  };

  const comingSoon = (label: string) =>
    Alert.alert(label, "Coming soon.");

  const emailCannotChange = () =>
    Alert.alert("Email", "Email can’t be changed.");

  return (
    <SafeAreaView className="flex-1 bg-[#FFFDF5]" edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        contentContainerStyle={{
          alignItems: "center",
          paddingHorizontal: 20,
          paddingBottom: 28,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full" style={{ maxWidth: contentWidth }}>
          {/* Header */}
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
                  My Profile
                </Text>
              </View>
              <View className="w-10 h-10" />
            </View>
          </View>

          {/* Profile header */}
          <View className="items-center mt-4">
            <View style={{ width: 140, height: 140 }}>
              <View
                className="rounded-full items-center justify-center"
                style={{
                  width: 140,
                  height: 140,
                  borderWidth: 4,
                  borderColor: "#CDE7EA",
                  backgroundColor: BG,
                }}
              >
                <Image
                  source={avatarSource}
                  style={{
                    width: 118,
                    height: 118,
                    borderRadius: 59,
                    backgroundColor: "#F2F3F5",
                  }}
                />
              </View>

              <Pressable
                onPress={onEditProfile}
                className="absolute bottom-0 right-0 w-12 h-12 rounded-full items-center justify-center"
                style={{
                  backgroundColor: "#CDE7EA",
                  borderWidth: 3,
                  borderColor: BG,
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
              >
                <Ionicons name="pencil" size={18} color="#4D6B73" />
              </Pressable>
            </View>

            <Text className="text-3xl font-bold text-[#1F1F1F] mt-5">
              {displayName}
            </Text>
            <Text className="text-lg mt-2" style={{ color: MUTED }}>
              {displayEmail}
            </Text>

            {isLoadingProfile ? (
              <View className="mt-4">
                <ActivityIndicator color={PRIMARY} />
              </View>
            ) : null}

            {profileError ? (
              <Text className="mt-4 text-center text-red-600 font-medium">
                {profileError}
              </Text>
            ) : null}

            {isSignedIn && !authedFetch ? (
              <Text className="mt-4 text-center text-red-600 font-medium">
                Missing API env var. Set EXPO_PUBLIC_API_URL.
              </Text>
            ) : null}
          </View>

          {/* Reading Statistics */}
          <Text className="text-xl font-bold text-[#1F1F1F] mt-10">
            Reading Statistics
          </Text>
          <View className="flex-row gap-4 mt-4">
            <View
              className="flex-1 rounded-3xl border border-[#E8E1D1] px-4 py-5"
              style={{ backgroundColor: "#EFF6F7" }}
            >
              <View className="mb-4">
                <Ionicons name="flame-outline" size={22} color={PRIMARY} />
              </View>
              <Text className="text-base text-[#1F1F1F] font-semibold">
                Days{"\n"}Streaked
              </Text>
              <Text className="text-4xl font-bold text-[#1F1F1F] mt-4">0</Text>
            </View>

            <View
              className="flex-1 rounded-3xl border border-[#E8E1D1] px-4 py-5"
              style={{ backgroundColor: "#EFF6F7" }}
            >
              <View className="mb-4">
                <Ionicons name="reader-outline" size={22} color={PRIMARY} />
              </View>
              <Text className="text-base text-[#1F1F1F] font-semibold">
                Verses{"\n"}Read
              </Text>
              <Text className="text-4xl font-bold text-[#1F1F1F] mt-4">0</Text>
            </View>
          </View>

          {/* Personal Information */}
          <Section title="Personal Information">
            <InfoRow
              icon="person-outline"
              label="First Name"
              value={(profile?.first_name ?? user?.firstName ?? "—") || "—"}
              onPress={onEditProfile}
            />
            <InfoRow
              icon="id-card-outline"
              label="Last Name"
              value={(profile?.last_name ?? user?.lastName ?? "—") || "—"}
              onPress={onEditProfile}
            />
            <InfoRow
              icon="mail-outline"
              label="Email"
              value={displayEmail}
              onPress={emailCannotChange}
            />
          </Section>

          {/* Account Settings */}
          <Section title="Account Settings">
            <SettingsRow
              icon="notifications-outline"
              label="Notifications"
              onPress={() => comingSoon("Notifications")}
            />
            <SettingsRow
              icon="language-outline"
              label="Language Settings"
              onPress={() => comingSoon("Language Settings")}
            />
            <SettingsRow
              icon="shield-checkmark-outline"
              label="Privacy & Security"
              onPress={() => comingSoon("Privacy & Security")}
            />
          </Section>

          {/* Logout */}
          <Pressable
            onPress={onLogoutOrSignIn}
            className="mt-10 rounded-full items-center justify-center flex-row"
            style={({ pressed }) => ({
              borderWidth: 2,
              borderColor: PRIMARY,
              paddingVertical: 16,
              backgroundColor: "transparent",
              opacity: pressed ? 0.85 : 1,
            })}
            accessibilityRole="button"
            accessibilityLabel={isSignedIn ? "Logout" : "Sign in or sign up"}
          >
            <Ionicons
              name={isSignedIn ? "log-out-outline" : "log-in-outline"}
              size={20}
              color={PRIMARY}
            />
            <Text
              className="text-lg font-semibold ml-3"
              style={{ color: PRIMARY }}
            >
              {isSignedIn ? "Logout" : "Sign In / Sign Up"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

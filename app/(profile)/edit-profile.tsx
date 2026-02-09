import { useAuth, useUser } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { Stack, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Profile } from "../../types/Profile";
import {
  createProfileIfMissing,
  fetchProfile,
  updateProfile,
} from "../../utils/profileApi";
import { useAuthedFetch } from "../../utils/apiClient";

const PRIMARY = "#A7D4DA";
const TEXT = "#1F1F1F";
const MUTED = "#7B8794";
const BORDER = "#E8E1D1";
const BG = "#FFFDF5";
const DISABLED_BG = "#F2F3F5";
const DEFAULT_AVATAR = require("../../assets/images/default-avatar.jpg");

function FormField({
  label,
  arabicLabel,
  value,
  onChangeText,
  placeholder,
  editable = true,
  keyboardType,
  autoCapitalize = "words",
}: {
  label: string;
  arabicLabel?: string;
  value: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  editable?: boolean;
  keyboardType?: React.ComponentProps<typeof TextInput>["keyboardType"];
  autoCapitalize?: React.ComponentProps<typeof TextInput>["autoCapitalize"];
}) {
  return (
    <View className="mt-6">
      <View className="flex-row justify-between mb-2">
        <Text className="text-base text-[#1F1F1F] font-medium">{label}</Text>
        {arabicLabel ? (
          <Text className="text-base text-[#97A6B2]">{arabicLabel}</Text>
        ) : null}
      </View>
      <View
        className="rounded-full px-5 py-4 border"
        style={{
          borderColor: BORDER,
          backgroundColor: editable ? "#FFFFFF" : DISABLED_BG,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#B0BAC5"
          editable={editable}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          className="text-base text-[#1F1F1F]"
          style={{ color: editable ? TEXT : MUTED }}
        />
      </View>
    </View>
  );
}

export default function EditProfileScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const contentWidth = useMemo(
    () => Math.min(420, Math.max(320, width - 40)),
    [width],
  );

  const authedFetch = useAuthedFetch();
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { isLoaded: isUserLoaded, user } = useUser();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  const hasInitializedForm = useRef(false);

  const userId = user?.id ?? null;
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";

  const avatarSource = useMemo(() => {
    if (isSignedIn && user?.imageUrl) return { uri: user.imageUrl };
    return DEFAULT_AVATAR;
  }, [isSignedIn, user?.imageUrl]);

  const loadProfile = useCallback(async () => {
    if (!isAuthLoaded || !isUserLoaded) return;

    if (!isSignedIn || !userId || !authedFetch) {
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

      if (!userEmail) {
        throw new Error("No email address found for this account.");
      }

      const created = await createProfileIfMissing(authedFetch, {
        email: userEmail,
        firstName: user?.firstName,
        lastName: user?.lastName,
      });
      setProfile(created);
    } catch (error) {
      console.error("Failed to load profile:", error);
      Alert.alert("Error", "Could not load your profile. Please try again.");
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
      void loadProfile();
    }, [loadProfile]),
  );

  useEffect(() => {
    if (hasInitializedForm.current) return;
    if (!isUserLoaded) return;
    if (isSignedIn && isLoadingProfile) return;

    const nextFirstName = (profile?.first_name ?? user?.firstName ?? "").trim();
    const nextLastName = (profile?.last_name ?? user?.lastName ?? "").trim();
    const nextPhone = (profile?.phone_number ?? "").trim();

    setFirstName(nextFirstName);
    setLastName(nextLastName);
    setPhoneNumber(nextPhone);
    hasInitializedForm.current = true;
  }, [
    isLoadingProfile,
    isSignedIn,
    isUserLoaded,
    profile?.first_name,
    profile?.last_name,
    profile?.phone_number,
    user?.firstName,
    user?.lastName,
  ]);

  const onChangePhotoPress = () => {
    Alert.alert("Change Photo", "Coming soon.");
  };

  const onSavePress = async () => {
    Keyboard.dismiss();

    if (!isSignedIn) {
      router.push("/(auth)/sign-in");
      return;
    }

    if (!authedFetch) {
      Alert.alert(
        "Missing API config",
        "Set EXPO_PUBLIC_API_URL.",
      );
      return;
    }

    if (!userId) {
      Alert.alert("Error", "Missing user id.");
      return;
    }

    setIsSaving(true);
    try {
      const nextFirstName = firstName.trim() || null;
      const nextLastName = lastName.trim() || null;
      const nextPhoneNumber = phoneNumber.trim();

      await updateProfile(authedFetch, {
        firstName: nextFirstName,
        lastName: nextLastName,
        phoneNumber: nextPhoneNumber.length > 0 ? nextPhoneNumber : null,
      });

      router.back();
    } catch (error) {
      console.error("Failed to update profile:", error);
      Alert.alert("Error", "Could not save changes. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const isEmailEditable = false;

  return (
    <SafeAreaView className="flex-1 bg-[#FFFDF5]" edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            contentContainerStyle={{
              alignItems: "center",
              paddingHorizontal: 20,
              paddingBottom: 28,
            }}
            keyboardShouldPersistTaps="handled"
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
                      Edit Profile
                    </Text>
                  </View>
                  <View className="w-10 h-10" />
                </View>
              </View>

              {/* Avatar */}
              <View className="items-center mt-6">
                <View style={{ width: 170, height: 170 }}>
                  <View
                    className="rounded-full items-center justify-center"
                    style={{
                      width: 170,
                      height: 170,
                      borderWidth: 5,
                      borderColor: "#FFFFFF",
                      backgroundColor: "#F2E7E2",
                    }}
                  >
                    <Image
                      source={avatarSource}
                      style={{
                        width: 155,
                        height: 155,
                        borderRadius: 77.5,
                        backgroundColor: "#F2F3F5",
                      }}
                    />
                  </View>

                  <Pressable
                    onPress={onChangePhotoPress}
                    className="absolute bottom-0 right-0 w-14 h-14 rounded-full items-center justify-center"
                    style={{
                      backgroundColor: "#CDE7EA",
                      borderWidth: 3,
                      borderColor: BG,
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Change photo"
                  >
                    <Ionicons name="camera-outline" size={22} color="#4D6B73" />
                  </Pressable>
                </View>
                <Pressable
                  onPress={onChangePhotoPress}
                  accessibilityRole="button"
                  accessibilityLabel="Change photo"
                  style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                >
                  <Text className="text-lg mt-4" style={{ color: MUTED }}>
                    Change Photo
                  </Text>
                </Pressable>

                {isLoadingProfile ? (
                  <View className="mt-4">
                    <ActivityIndicator color={PRIMARY} />
                  </View>
                ) : null}
              </View>

              {/* Fields */}
              <FormField
                label="First Name"
                arabicLabel="الاسم الأول"
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First Name"
                editable={isSignedIn}
              />
              <FormField
                label="Last Name"
                arabicLabel="اسم العائلة"
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last Name"
                editable={isSignedIn}
              />
              <FormField
                label="Email Address"
                arabicLabel="البريد الإلكتروني"
                value={userEmail || "Sign in to view your email"}
                placeholder="Email"
                editable={isEmailEditable}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <FormField
                label="Phone Number"
                arabicLabel="رقم الهاتف"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder="+1 555 123 4567"
                editable={isSignedIn}
                keyboardType={Platform.OS === "ios" ? "number-pad" : "phone-pad"}
                autoCapitalize="none"
              />

              {/* Save */}
              <Pressable
                onPress={onSavePress}
                disabled={isSaving}
                className="mt-10 rounded-full items-center justify-center"
                style={({ pressed }) => ({
                  backgroundColor: PRIMARY,
                  paddingVertical: 18,
                  opacity: isSaving ? 0.6 : pressed ? 0.9 : 1,
                })}
                accessibilityRole="button"
                accessibilityLabel="Save changes"
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text className="text-xl font-semibold text-[#1F1F1F]">
                    {isSignedIn ? "Save Changes" : "Sign In to Save"}
                  </Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

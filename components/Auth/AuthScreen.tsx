import { useOAuth, useSignIn, useSignUp } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useWarmUpBrowser } from "../../hooks/useWarmUpBrowser";

type AuthTab = "signIn" | "signUp";

const PRIMARY = "#A7D4DA";
const TEXT = "#1F1F1F";
const PRIMARY_BUTTON_BG = "#7FC6CF";
const PRIMARY_BUTTON_TEXT = "#10353C";

const getClerkErrorMessage = (error: unknown) => {
  const fallback = "Something went wrong. Please try again.";

  if (!error || typeof error !== "object") return fallback;

  const anyError = error as { errors?: Record<string, unknown>[] };
  const first = anyError.errors?.[0];
  const longMessage =
    first && typeof first.longMessage === "string" ? first.longMessage : null;
  const message = first && typeof first.message === "string" ? first.message : null;
  if (longMessage) return longMessage;
  if (message) return message;

  if ("message" in (error as Record<string, unknown>)) {
    const maybeMessage = (error as Record<string, unknown>).message;
    if (typeof maybeMessage === "string" && maybeMessage.length > 0) {
      return maybeMessage;
    }
  }

  return fallback;
};

export default function AuthScreen({
  initialTab,
  onBack,
}: {
  initialTab: AuthTab;
  onBack: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const contentWidth = useMemo(
    () => Math.min(420, Math.max(320, width - 40)),
    [width],
  );
  const isCompactHeight = height < 760;
  const inputTextStyle = useMemo(
    () => ({
      fontSize: 16,
      lineHeight: 22,
      color: TEXT,
      paddingVertical: Platform.OS === "ios" ? 2 : 0,
      ...(Platform.OS === "android"
        ? { includeFontPadding: false, textAlignVertical: "center" as const }
        : {}),
    }),
    [],
  );

  useWarmUpBrowser();

  const {
    isLoaded: isSignInLoaded,
    signIn,
    setActive: setActiveSignIn,
  } = useSignIn();
  const {
    isLoaded: isSignUpLoaded,
    signUp,
    setActive: setActiveSignUp,
  } = useSignUp();
  const { startOAuthFlow } = useOAuth({ strategy: "oauth_google" });

  const [tab, setTab] = useState<AuthTab>(initialTab);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordHidden, setIsPasswordHidden] = useState(true);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingEmailVerification, setPendingEmailVerification] = useState(false);
  const [emailVerificationCode, setEmailVerificationCode] = useState("");

  const headerTitle = pendingEmailVerification
    ? "Verify Email"
    : tab === "signIn"
      ? "Welcome Back"
      : "Create Account";

  const switchTab = (nextTab: AuthTab) => {
    setErrorMessage(null);
    setPendingEmailVerification(false);
    setEmailVerificationCode("");
    setTab(nextTab);
  };

  const onGooglePress = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const { createdSessionId, setActive } = await startOAuthFlow();
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      }
    } catch (error) {
      setErrorMessage(getClerkErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSignInPress = async () => {
    if (!isSignInLoaded) return;
    setErrorMessage(null);

    const identifier = email.trim();
    if (!identifier || !password) {
      setErrorMessage("Please enter your email and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const signInAttempt = await signIn.create({
        identifier,
        password,
      });

      if (signInAttempt.status === "complete") {
        await setActiveSignIn({ session: signInAttempt.createdSessionId });
      } else {
        setErrorMessage("Additional verification is required to sign in.");
      }
    } catch (error) {
      setErrorMessage(getClerkErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const onCreateAccountPress = async () => {
    if (!isSignUpLoaded) return;
    setErrorMessage(null);

    const emailAddress = email.trim();
    if (!emailAddress || !password) {
      setErrorMessage("Please enter your email and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const signUpAttempt = await signUp.create({
        emailAddress,
        password,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      });

      if (signUpAttempt.status === "complete") {
        await setActiveSignUp({ session: signUpAttempt.createdSessionId });
        return;
      }

      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setPendingEmailVerification(true);
    } catch (error) {
      setErrorMessage(getClerkErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const onVerifyEmailPress = async () => {
    if (!isSignUpLoaded) return;
    setErrorMessage(null);

    const code = emailVerificationCode.trim();
    if (!code) {
      setErrorMessage("Enter the verification code.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === "complete") {
        await setActiveSignUp({ session: result.createdSessionId });
      } else {
        setErrorMessage("Verification is not complete yet.");
      }
    } catch (error) {
      setErrorMessage(getClerkErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const onResendVerificationCodePress = async () => {
    if (!isSignUpLoaded) return;
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    } catch (error) {
      setErrorMessage(getClerkErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
    >
      <Pressable
        style={{ flex: 1 }}
        onPress={Keyboard.dismiss}
        accessible={false}
      >
        <ScrollView
          style={{ flex: 1, backgroundColor: "#FFFDF5" }}
          contentContainerStyle={{
            flexGrow: 1,
            alignItems: "center",
            paddingHorizontal: 20,
            paddingBottom: isCompactHeight ? 72 : 92,
          }}
          keyboardShouldPersistTaps="always"
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          <View className="w-full" style={{ maxWidth: contentWidth }}>
            <View
              className="pt-4 pb-2"
              style={{ marginBottom: isCompactHeight ? 2 : 6 }}
            >
              <View className="flex-row items-center">
                <Pressable
                  onPress={onBack}
                  className="w-10 h-10 items-center justify-center"
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                >
                  <Ionicons name="chevron-back" size={26} color={TEXT} />
                </Pressable>
                <View className="flex-1 items-center" pointerEvents="none">
                  <Text className="text-xl font-semibold text-[#1F1F1F]">
                    {headerTitle}
                  </Text>
                </View>
                <View className="w-10 h-10" />
              </View>
            </View>

            {tab === "signIn" ? (
              <View style={{ marginTop: isCompactHeight ? 8 : 18 }}>
                <Text
                  className={
                    isCompactHeight
                      ? "text-4xl font-bold text-[#1F1F1F]"
                      : "text-5xl font-bold text-[#1F1F1F]"
                  }
                >
                  Peace be upon you
                </Text>
                <Text
                  className="text-lg mt-2 text-[#7B8794]"
                  style={{ marginBottom: isCompactHeight ? 10 : 14 }}
                >
                  Sign in to continue your spiritual journey
                </Text>
              </View>
            ) : (
              <View
                className="items-center"
                style={{ marginTop: isCompactHeight ? 6 : 12 }}
              >
                <View
                  className={
                    isCompactHeight
                      ? "w-20 h-20 rounded-full items-center justify-center"
                      : "w-24 h-24 rounded-full items-center justify-center"
                  }
                  style={{ backgroundColor: "#ECF7FA" }}
                >
                  <Ionicons name="book-outline" size={40} color={PRIMARY} />
                </View>
                <Text
                  className={
                    isCompactHeight
                      ? "text-3xl font-bold text-[#1F1F1F] text-center mt-4"
                      : "text-4xl font-bold text-[#1F1F1F] text-center mt-5"
                  }
                >
                  Join Our Community
                </Text>
                <Text className="text-lg mt-2 text-[#7B8794] text-center">
                  Begin your spiritual journey and track your progress daily.
                </Text>
              </View>
            )}

            <View className="mt-6 border-b border-[#E8E1D1] flex-row">
              <Pressable
                onPress={() => switchTab("signIn")}
                className="flex-1 items-center pb-3"
                accessibilityRole="button"
                accessibilityLabel="Sign in tab"
              >
                <Text
                  className={
                    tab === "signIn"
                      ? "text-base font-semibold text-[#1F1F1F]"
                      : "text-base font-semibold text-[#97A6B2]"
                  }
                >
                  Sign In
                </Text>
                <View
                  className="mt-3 h-1 rounded-full"
                  style={{
                    width: 44,
                    backgroundColor:
                      tab === "signIn" ? PRIMARY : "transparent",
                  }}
                />
              </Pressable>
              <Pressable
                onPress={() => switchTab("signUp")}
                className="flex-1 items-center pb-3"
                accessibilityRole="button"
                accessibilityLabel="Sign up tab"
              >
                <Text
                  className={
                    tab === "signUp"
                      ? "text-base font-semibold text-[#1F1F1F]"
                      : "text-base font-semibold text-[#97A6B2]"
                  }
                >
                  Sign Up
                </Text>
                <View
                  className="mt-3 h-1 rounded-full"
                  style={{
                    width: 44,
                    backgroundColor: tab === "signUp" ? PRIMARY : "transparent",
                  }}
                />
              </Pressable>
            </View>

            <View style={{ marginTop: isCompactHeight ? 14 : 18 }}>
              {tab === "signIn" ? (
                <>
                  <View>
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-base text-[#1F1F1F] font-medium">
                        Email Address
                      </Text>
                      <Text className="text-base text-[#97A6B2]">
                        البريد الإلكتروني
                      </Text>
                    </View>
                    <View className="bg-white border border-[#E8E1D1] rounded-3xl px-5 py-3.5">
                      <TextInput
                        value={email}
                        onChangeText={setEmail}
                        placeholder="Enter your email"
                        placeholderTextColor="#B0BAC5"
                        autoCapitalize="none"
                        keyboardType="email-address"
                        style={inputTextStyle}
                      />
                    </View>
                  </View>

                  <View className="mt-4">
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-base text-[#1F1F1F] font-medium">
                        Password
                      </Text>
                      <Text className="text-base text-[#97A6B2]">
                        كلمة المرور
                      </Text>
                    </View>
                    <View className="bg-white border border-[#E8E1D1] rounded-3xl px-5 py-3.5 flex-row items-center">
                      <TextInput
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Enter your password"
                        placeholderTextColor="#B0BAC5"
                        secureTextEntry={isPasswordHidden}
                        className="flex-1"
                        style={inputTextStyle}
                      />
                      <Pressable
                        onPress={() => setIsPasswordHidden((v) => !v)}
                        className="pl-4"
                        accessibilityRole="button"
                        accessibilityLabel={
                          isPasswordHidden ? "Show password" : "Hide password"
                        }
                      >
                        <Ionicons
                          name={isPasswordHidden ? "eye-outline" : "eye-off-outline"}
                          size={22}
                          color="#6B7C8A"
                        />
                      </Pressable>
                    </View>
                    <Pressable
                      onPress={() => {
                        Alert.alert(
                          "Forgot Password",
                          "Password reset isn't wired up yet. Add a reset flow with Clerk when you're ready.",
                        );
                      }}
                      className="mt-3 items-end"
                      accessibilityRole="button"
                      accessibilityLabel="Forgot password"
                    >
                      <Text style={{ color: PRIMARY }} className="text-base font-semibold">
                        Forgot Password?
                      </Text>
                    </Pressable>
                  </View>

                  <View style={{ marginTop: isCompactHeight ? 14 : 18 }}>
                    <Pressable
                      onPress={onSignInPress}
                      disabled={!isSignInLoaded || isSubmitting}
                      className="rounded-full items-center justify-center"
                      style={({ pressed }) => ({
                        backgroundColor: PRIMARY_BUTTON_BG,
                        paddingVertical: 16,
                        minHeight: 56,
                        shadowColor: "#000",
                        shadowOpacity: 0.08,
                        shadowRadius: 14,
                        shadowOffset: { width: 0, height: 8 },
                        elevation: 4,
                        opacity:
                          !isSignInLoaded || isSubmitting ? 0.72 : pressed ? 0.9 : 1,
                      })}
                      accessibilityRole="button"
                      accessibilityLabel="Sign in"
                    >
                      {isSubmitting ? (
                        <ActivityIndicator color={PRIMARY_BUTTON_TEXT} />
                      ) : (
                        <Text
                          className="text-xl font-semibold"
                          style={{ color: PRIMARY_BUTTON_TEXT }}
                        >
                          Sign In
                        </Text>
                      )}
                    </Pressable>

                    <View className="mt-6 flex-row items-center justify-center">
                      <View className="flex-1 h-px bg-[#E8E1D1]" />
                      <Text className="mx-4 text-base text-[#97A6B2]">
                        Or continue with
                      </Text>
                      <View className="flex-1 h-px bg-[#E8E1D1]" />
                    </View>

                    <Pressable
                      onPress={onGooglePress}
                      disabled={isSubmitting}
                      style={({ pressed }) => ({
                        opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1,
                      })}
                      className="mt-4 bg-white border border-[#E8E1D1] rounded-3xl px-5 py-3.5 flex-row items-center justify-center"
                      accessibilityRole="button"
                      accessibilityLabel="Sign in with Google"
                    >
                      <View
                        className="w-8 h-8 rounded-full items-center justify-center mr-3"
                        style={{ backgroundColor: "#F2F3F5" }}
                      >
                        <Text className="text-base font-bold">G</Text>
                      </View>
                      <Text className="text-lg font-semibold text-[#1F1F1F]">
                        Sign in with Google
                      </Text>
                    </Pressable>

                    {errorMessage ? (
                      <Text className="mt-4 text-center text-red-600 font-medium">
                        {errorMessage}
                      </Text>
                    ) : null}
                  </View>
                </>
              ) : (
                <>
                  <View className="flex-row gap-4">
                    <View className="flex-1">
                      <View className="flex-row justify-between mb-2">
                        <Text className="text-base text-[#1F1F1F] font-medium">
                          First Name
                        </Text>
                        <Text className="text-base text-[#97A6B2]">
                          الاسم الأول
                        </Text>
                      </View>
                      <View className="bg-white border border-[#E8E1D1] rounded-3xl px-5 py-3.5">
                        <TextInput
                          value={firstName}
                          onChangeText={setFirstName}
                          placeholder="First Name"
                          placeholderTextColor="#B0BAC5"
                          style={inputTextStyle}
                        />
                      </View>
                    </View>

                    <View className="flex-1">
                      <View className="flex-row justify-between mb-2">
                        <Text className="text-base text-[#1F1F1F] font-medium">
                          Last Name
                        </Text>
                        <Text className="text-base text-[#97A6B2]">
                          اسم العائلة
                        </Text>
                      </View>
                      <View className="bg-white border border-[#E8E1D1] rounded-3xl px-5 py-3.5">
                        <TextInput
                          value={lastName}
                          onChangeText={setLastName}
                          placeholder="Last Name"
                          placeholderTextColor="#B0BAC5"
                          style={inputTextStyle}
                        />
                      </View>
                    </View>
                  </View>

                  <View className="mt-4">
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-base text-[#1F1F1F] font-medium">
                        Email Address
                      </Text>
                      <Text className="text-base text-[#97A6B2]">
                        البريد الإلكتروني
                      </Text>
                    </View>
                    <View className="bg-white border border-[#E8E1D1] rounded-3xl px-5 py-3.5">
                      <TextInput
                        value={email}
                        onChangeText={setEmail}
                        placeholder="example@email.com"
                        placeholderTextColor="#B0BAC5"
                        autoCapitalize="none"
                        keyboardType="email-address"
                        style={inputTextStyle}
                      />
                    </View>
                  </View>

                  <View className="mt-4">
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-base text-[#1F1F1F] font-medium">
                        Password
                      </Text>
                      <Text className="text-base text-[#97A6B2]">
                        كلمة المرور
                      </Text>
                    </View>
                    <View className="bg-white border border-[#E8E1D1] rounded-3xl px-5 py-3.5 flex-row items-center">
                      <TextInput
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Enter your password"
                        placeholderTextColor="#B0BAC5"
                        secureTextEntry={isPasswordHidden}
                        className="flex-1"
                        style={inputTextStyle}
                      />
                      <Pressable
                        onPress={() => setIsPasswordHidden((v) => !v)}
                        className="pl-4"
                        accessibilityRole="button"
                        accessibilityLabel={
                          isPasswordHidden ? "Show password" : "Hide password"
                        }
                      >
                        <Ionicons
                          name={isPasswordHidden ? "eye-outline" : "eye-off-outline"}
                          size={22}
                          color="#6B7C8A"
                        />
                      </Pressable>
                    </View>
                  </View>

                  <View style={{ marginTop: isCompactHeight ? 14 : 18 }}>
                    <Pressable
                      onPress={onCreateAccountPress}
                      disabled={!isSignUpLoaded || isSubmitting || pendingEmailVerification}
                      className="rounded-full items-center justify-center"
                      style={({ pressed }) => ({
                        backgroundColor: PRIMARY_BUTTON_BG,
                        paddingVertical: 16,
                        minHeight: 56,
                        shadowColor: "#000",
                        shadowOpacity: 0.08,
                        shadowRadius: 14,
                        shadowOffset: { width: 0, height: 8 },
                        elevation: 4,
                        opacity:
                          !isSignUpLoaded || isSubmitting || pendingEmailVerification
                            ? 0.72
                            : pressed
                              ? 0.9
                              : 1,
                      })}
                      accessibilityRole="button"
                      accessibilityLabel="Create account"
                    >
                      {isSubmitting && !pendingEmailVerification ? (
                        <ActivityIndicator color={PRIMARY_BUTTON_TEXT} />
                      ) : (
                        <Text
                          className="text-xl font-semibold"
                          style={{ color: PRIMARY_BUTTON_TEXT }}
                        >
                          Create Account
                        </Text>
                      )}
                    </Pressable>

                    {pendingEmailVerification ? (
                      <View className="mt-5">
                        <Text className="text-base text-[#7B8794] text-center">
                          We sent a verification code to{" "}
                          <Text className="font-semibold text-[#1F1F1F]">
                            {email.trim() || "your email"}
                          </Text>
                          .
                        </Text>

                        <View className="mt-4">
                          <View className="flex-row justify-between mb-2">
                            <Text className="text-base text-[#1F1F1F] font-medium">
                              Verification Code
                            </Text>
                            <Text className="text-base text-[#97A6B2]">
                              Ø±Ù…Ø² Ø§Ù„ØªØ­Ù‚Ù‚
                            </Text>
                          </View>
                          <View className="bg-white border border-[#E8E1D1] rounded-3xl px-5 py-3.5">
                            <TextInput
                              value={emailVerificationCode}
                              onChangeText={setEmailVerificationCode}
                              placeholder="Enter code"
                              placeholderTextColor="#B0BAC5"
                              keyboardType={
                                Platform.OS === "ios" ? "number-pad" : "numeric"
                              }
                              style={inputTextStyle}
                            />
                          </View>
                        </View>

                        <Pressable
                          onPress={onVerifyEmailPress}
                          disabled={isSubmitting}
                          className="mt-4 rounded-full items-center justify-center"
                          style={({ pressed }) => ({
                            backgroundColor: PRIMARY_BUTTON_BG,
                            paddingVertical: 16,
                            minHeight: 56,
                            shadowColor: "#000",
                            shadowOpacity: 0.08,
                            shadowRadius: 14,
                            shadowOffset: { width: 0, height: 8 },
                            elevation: 4,
                            opacity: isSubmitting ? 0.6 : pressed ? 0.9 : 1,
                          })}
                          accessibilityRole="button"
                          accessibilityLabel="Verify email"
                        >
                          {isSubmitting ? (
                            <ActivityIndicator color={PRIMARY_BUTTON_TEXT} />
                          ) : (
                            <Text
                              className="text-xl font-semibold"
                              style={{ color: PRIMARY_BUTTON_TEXT }}
                            >
                              Verify Email
                            </Text>
                          )}
                        </Pressable>

                        <Pressable
                          onPress={onResendVerificationCodePress}
                          disabled={isSubmitting}
                          style={({ pressed }) => ({
                            opacity: isSubmitting ? 0.6 : pressed ? 0.8 : 1,
                          })}
                          className="mt-3 items-center"
                          accessibilityRole="button"
                          accessibilityLabel="Resend verification code"
                        >
                          <Text
                            style={{ color: PRIMARY }}
                            className="text-base font-semibold"
                          >
                            Resend code
                          </Text>
                        </Pressable>

                        {errorMessage ? (
                          <Text className="mt-4 text-center text-red-600 font-medium">
                            {errorMessage}
                          </Text>
                        ) : null}
                      </View>
                    ) : (
                      <>
                        <View className="mt-6 flex-row items-center justify-center">
                          <View className="flex-1 h-px bg-[#E8E1D1]" />
                          <Text className="mx-4 text-base text-[#97A6B2]">
                            OR
                          </Text>
                          <View className="flex-1 h-px bg-[#E8E1D1]" />
                        </View>

                        <Pressable
                          onPress={onGooglePress}
                          disabled={isSubmitting}
                          style={({ pressed }) => ({
                            opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1,
                          })}
                          className="mt-4 bg-white border border-[#E8E1D1] rounded-3xl px-5 py-3.5 flex-row items-center justify-center"
                          accessibilityRole="button"
                          accessibilityLabel="Sign up with Google"
                        >
                          <View
                            className="w-8 h-8 rounded-full items-center justify-center mr-3"
                            style={{ backgroundColor: "#F2F3F5" }}
                          >
                            <Text className="text-base font-bold">G</Text>
                          </View>
                          <Text className="text-lg font-semibold text-[#1F1F1F]">
                            Sign up with Google
                          </Text>
                        </Pressable>

                        {errorMessage ? (
                          <Text className="mt-4 text-center text-red-600 font-medium">
                            {errorMessage}
                          </Text>
                        ) : null}

                        <View className="mt-5 items-center">
                          <Text className="text-sm text-[#97A6B2] text-center">
                            By signing up, you agree to our{" "}
                            <Text
                              style={{ color: PRIMARY }}
                              className="font-semibold"
                            >
                              Terms of Service
                            </Text>{" "}
                            and{" "}
                            <Text
                              style={{ color: PRIMARY }}
                              className="font-semibold"
                            >
                              Privacy Policy
                            </Text>
                            .
                          </Text>
                        </View>
                      </>
                    )}
                  </View>
                </>
              )}
            </View>
          </View>
        </ScrollView>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

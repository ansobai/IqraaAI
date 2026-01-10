import React from "react";
import {
  Image,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";

type BannerSize = "sm" | "md" | "lg";

const SIZE_STYLES: Record<
  BannerSize,
  {
    fontSize: number;
    paddingVertical: number;
    paddingHorizontal: number;
    minHeight: number;
  }
> = {
  sm: {
    fontSize: 16,
    paddingVertical: 6,
    paddingHorizontal: 18,
    minHeight: 44,
  },
  md: {
    fontSize: 18,
    paddingVertical: 8,
    paddingHorizontal: 22,
    minHeight: 56,
  },
  lg: {
    fontSize: 26,
    paddingVertical: 6,
    paddingHorizontal: 24,
    minHeight: 80,
  },
};

const styles = StyleSheet.create({
  image: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  textWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});

interface Props {
  label: string;
  size?: BannerSize;
  containerStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export default function SurahBanner({
  label,
  size = "md",
  containerStyle,
  textStyle,
}: Props) {
  const sizeStyle = SIZE_STYLES[size];
  const lineHeight = Math.round(sizeStyle.fontSize * 1.4);
  const bannerHeight = Math.max(
    sizeStyle.minHeight,
    lineHeight + sizeStyle.paddingVertical * 2
  );
  const isLarge = size === "lg";
  const bannerWidth = isLarge ? "100%" : undefined;

  return (
    <View
      style={[
        {
          height: bannerHeight,
          position: "relative",
          alignItems: "center",
          justifyContent: "center",
          alignSelf: "center",
          overflow: "hidden",
          ...(bannerWidth ? { width: bannerWidth } : null),
        },
        containerStyle,
      ]}
    >
      <Image
        source={require("../assets/images/surah-banner.png")}
        resizeMode="stretch"
        style={styles.image}
      />
      <View
        style={[
          styles.textWrap,
          {
            paddingVertical: sizeStyle.paddingVertical,
            paddingHorizontal: sizeStyle.paddingHorizontal,
            ...(isLarge ? { width: "100%" } : null),
          },
        ]}
      >
        <Text
          className="text-[#1F1F1F] font-amiri"
          style={[
            {
              fontSize: sizeStyle.fontSize,
              lineHeight,
              textAlign: "center",
              ...(isLarge ? { width: "100%" } : null),
              writingDirection: "rtl",
            },
            textStyle,
          ]}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

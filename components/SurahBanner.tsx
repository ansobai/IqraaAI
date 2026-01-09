import React from "react";
import {
  ImageBackground,
  StyleProp,
  Text,
  TextStyle,
  ViewStyle,
} from "react-native";
import { FONTS } from "../constants/theme";

type BannerSize = "sm" | "md" | "lg";

const SIZE_STYLES: Record<
  BannerSize,
  { fontSize: number; paddingVertical: number; paddingHorizontal: number; minHeight: number }
> = {
  sm: { fontSize: 16, paddingVertical: 6, paddingHorizontal: 20, minHeight: 32 },
  md: { fontSize: 18, paddingVertical: 8, paddingHorizontal: 24, minHeight: 38 },
  lg: { fontSize: 22, paddingVertical: 10, paddingHorizontal: 28, minHeight: 46 },
};

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

  return (
    <ImageBackground
      source={require("../assets/images/surah-banner.jpg")}
      resizeMode="stretch"
      style={[
        {
          alignSelf: "center",
          alignItems: "center",
          justifyContent: "center",
          minHeight: sizeStyle.minHeight,
          paddingVertical: sizeStyle.paddingVertical,
          paddingHorizontal: sizeStyle.paddingHorizontal,
        },
        containerStyle,
      ]}
    >
      <Text
        style={[
          {
            fontFamily: FONTS.arabic,
            fontSize: sizeStyle.fontSize,
            color: "#1F1F1F",
            textAlign: "center",
          },
          textStyle,
        ]}
      >
        {label}
      </Text>
    </ImageBackground>
  );
}

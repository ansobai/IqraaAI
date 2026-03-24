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
export type BannerVariant = "default" | "left" | "right";

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
    paddingVertical: 4,
    paddingHorizontal: 18,
    minHeight: 36,
  },
  md: {
    fontSize: 18,
    paddingVertical: 6,
    paddingHorizontal: 22,
    minHeight: 46,
  },
  lg: {
    fontSize: 26,
    paddingVertical: 4,
    paddingHorizontal: 24,
    minHeight: 60,
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
  variant?: BannerVariant;
  containerStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  lineHeight?: number;
}

export default function SurahBanner({
  label,
  size = "md",
  variant = "default",
  containerStyle,
  textStyle,
  lineHeight,
}: Props) {
  const sizeStyle = SIZE_STYLES[size];
  const usesLineHeight = Number.isFinite(lineHeight) && lineHeight! > 0;
  const computedFontSize = usesLineHeight
    ? Math.max(10, Math.round(lineHeight! * 0.7))
    : sizeStyle.fontSize;
  const computedLineHeight = usesLineHeight
    ? Math.round(computedFontSize * 1.3)
    : Math.round(sizeStyle.fontSize * 1.4);
  const bannerHeight = usesLineHeight
    ? Math.round(lineHeight!)
    : Math.max(
        sizeStyle.minHeight,
        computedLineHeight + sizeStyle.paddingVertical * 2
      );
  const isLarge = size === "lg";
  const bannerWidth = isLarge ? "100%" : undefined;
  const paddingVertical = usesLineHeight ? 0 : sizeStyle.paddingVertical;
  const paddingHorizontal = sizeStyle.paddingHorizontal;

  // Variant logic
  let imageSource;
  let textAlign: "center" | "left" | "right" = "center";
  
  switch (variant) {
    case "left":
      imageSource = require("../assets/images/overlay-design.jpeg");
      break;
    case "right":
      imageSource = require("../assets/images/overlay-design.jpeg");
      break;
    default:
      imageSource = require("../assets/images/overlay-design.jpeg");
      break;
  }

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
        source={imageSource}
        resizeMode="stretch"
        style={styles.image}
      />
      <View
        style={[
          styles.textWrap,
          {
            paddingVertical,
            paddingHorizontal,
            width: "100%", // Wrapper takes full width to allow internal alignment
            ...(isLarge ? { width: "100%" } : null),
            alignItems: "center",
          },
        ]}
      >
        <Text
          className="text-[#1F1F1F] font-scheherazade"
          numberOfLines={1}
          style={[
            {
              fontFamily: "Scheherazade",
              fontSize: computedFontSize,
              lineHeight: computedLineHeight,
              textAlign,
              width: "100%",
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

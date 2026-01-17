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
export type BannerVariant = "default" | "left" | "right" | "page";

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
  let textWidthPercent = "100%";
  let textAlign: "center" | "left" | "right" = "center";
  
  // Alignment adjustments based on the half-shape logic
  // If it's the "left" piece (next surah), we might want the text aligned to the visible part.
  // The user said "left is next", "right is previous".
  // "left" image shows the left half of the shape. Usually that means the text should be on the left side?
  // Or if it's cutting off the right side, the text should be left-aligned.
  // Let's assume standard centering within the available "half" width for now, or align towards the center of the screen.
  // Actually, if it's the "left" banner, it sits on the left of the screen. The right side is cut off.
  // So text should be on the left side of the banner.
  
  switch (variant) {
    case "left":
      imageSource = require("../assets/images/surah_name_border_left_2.png");
      textWidthPercent = "60%"; // Constrain width
      textAlign = "left"; // Align to visible side
      break;
    case "right":
      imageSource = require("../assets/images/surah_name_border_right_2.png");
      textWidthPercent = "60%";
      textAlign = "right";
      break;
    case "page":
      imageSource = require("../assets/images/surah_banner.png");
      // Page banner is wide, text centered
      textWidthPercent = "100%";
      textAlign = "center";
      break;
    default:
      imageSource = require("../assets/images/surah_name-border.png");
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
            // For variants, we might need to shift the content area
            alignItems: variant === "left" ? "flex-start" : variant === "right" ? "flex-end" : "center",
            paddingLeft: variant === "left" ? paddingHorizontal : undefined,
            paddingRight: variant === "right" ? paddingHorizontal : undefined,
          },
        ]}
      >
        <Text
          className="text-[#1F1F1F] font-uthmanic"
          numberOfLines={1}
          style={[
            {
              fontSize: computedFontSize,
              lineHeight: computedLineHeight,
              textAlign: "center", // Text itself is centered within its constrained width
              width: variant === "default" ? (isLarge ? "100%" : undefined) : textWidthPercent,
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

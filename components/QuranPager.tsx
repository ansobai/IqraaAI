import React, { useEffect, useState } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  type GestureType,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface QuranPagerProps<T> {
  data: T[];
  initialIndex: number;
  onIndexChange: (index: number) => void;
  renderItem: (props: { item: T; index: number }) => React.ReactNode;
  scrollEnabled?: boolean;
  pageWidth?: number;
  simultaneousGestures?: GestureType[];
}

export default function QuranPager<T>({
  data,
  initialIndex,
  onIndexChange,
  renderItem,
  scrollEnabled = true,
  pageWidth,
  simultaneousGestures,
}: QuranPagerProps<T>) {
  const [index, setIndex] = useState(initialIndex);
  const effectiveWidth = Math.max(1, pageWidth ?? SCREEN_WIDTH);
  
  // The master offset of the container. 
  // 0 -> Page 0 is visible.
  // width -> Page 1 is visible (content is shifted right, page 1 was at -width).
  // index * width -> Page index is visible.
  const offset = useSharedValue(initialIndex * effectiveWidth);
  const contextOffset = useSharedValue(0);

  // Sync internal state if initialIndex prop changes (e.g. jump from surah list)
  useEffect(() => {
    setIndex(initialIndex);
    offset.value = initialIndex * effectiveWidth;
  }, [initialIndex, effectiveWidth, offset]);

  // Notify parent of index changes only when animation settles
  const handleIndexChange = (newIndex: number) => {
    if (newIndex !== index) {
      setIndex(newIndex);
      onIndexChange(newIndex);
    }
  };

  const pan = Gesture.Pan()
    .enabled(scrollEnabled)
    .minPointers(1)
    .maxPointers(1)
    .activeOffsetX([-20, 20])
    .onStart(() => {
      contextOffset.value = offset.value;
    })
    .onUpdate((event) => {
      let nextOffset = contextOffset.value + event.translationX;

      // Boundary resistance
      // Start boundary (Page 0) -> offset cannot go < 0
      if (nextOffset < 0) {
        nextOffset *= 0.5;
      }
      // End boundary (Last Page) -> offset cannot go > (N-1)*width
      const maxOffset = (data.length - 1) * effectiveWidth;
      if (nextOffset > maxOffset) {
        // Apply resistance relative to the boundary
        const overscroll = nextOffset - maxOffset;
        nextOffset = maxOffset + overscroll * 0.5;
      }

      offset.value = nextOffset;
    })
    .onEnd((event) => {
      const currentPos = offset.value / effectiveWidth;
      const velocity = event.velocityX / effectiveWidth; // Normalize velocity
      
      // Determine target page index based on position and velocity
      let targetIndex = Math.round(currentPos);

      // If velocity is high enough, snap to next/prev even if not fully there
      if (Math.abs(velocity) > 0.3) {
        if (velocity > 0) {
          targetIndex = Math.ceil(currentPos);
        } else {
          targetIndex = Math.floor(currentPos);
        }
      }

      // Clamp target index
      targetIndex = Math.max(0, Math.min(targetIndex, data.length - 1));

      // Animate to target
      const targetOffset = targetIndex * effectiveWidth;
      
      offset.value = withTiming(targetOffset, { duration: 250 }, (finished) => {
        if (finished) {
          runOnJS(handleIndexChange)(targetIndex);
        }
      });
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  // Render window: [index-1, index, index+1]
  const pagesToRender = [-1, 0, 1].map((diff) => {
    const targetIndex = index + diff;
    if (targetIndex < 0 || targetIndex >= data.length) return null;

    // Absolute position: Page i is always at -i * width (RTL Layout)
    // Since we translate container by +index*width,
    // Page i at -index*width becomes visible at 0.
    const left = -targetIndex * effectiveWidth;

    return (
      <View
        key={targetIndex}
        style={[styles.page, { left, width: effectiveWidth }]}
      >
        {renderItem({ item: data[targetIndex], index: targetIndex })}
      </View>
    );
  });

  const composedGesture = simultaneousGestures?.length
    ? Gesture.Simultaneous(pan, ...simultaneousGestures)
    : pan;

  return (
    <View style={styles.container}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[styles.track, animatedStyle]}>
          {pagesToRender}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
    flexDirection: "row", // Ensure pages are laid out horizontally context
  },
  track: {
    flex: 1,
    // We don't need flex direction here strictly if we use absolute positioning,
    // but it keeps the container's intent clear.
    width: "100%",
    height: "100%",
  },
  page: {
    position: "absolute",
    top: 0,
    bottom: 0,
    // width is applied inline to keep it in sync with layout
    flex: 0,
  },
});

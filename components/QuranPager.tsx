import React, { useEffect, useState, useRef } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  useAnimatedReaction,
} from "react-native-reanimated";

const { width } = Dimensions.get("window");

interface QuranPagerProps<T> {
  data: T[];
  initialIndex: number;
  onIndexChange: (index: number) => void;
  renderItem: (props: { item: T; index: number }) => React.ReactNode;
  scrollEnabled?: boolean;
}

export default function QuranPager<T>({
  data,
  initialIndex,
  onIndexChange,
  renderItem,
  scrollEnabled = true,
}: QuranPagerProps<T>) {
  const [index, setIndex] = useState(initialIndex);
  
  // The master offset of the container. 
  // 0 -> Page 0 is visible.
  // width -> Page 1 is visible (content is shifted right, page 1 was at -width).
  // index * width -> Page index is visible.
  const offset = useSharedValue(initialIndex * width);
  const contextOffset = useSharedValue(0);

  // Sync internal state if initialIndex prop changes (e.g. jump from surah list)
  useEffect(() => {
    setIndex(initialIndex);
    offset.value = initialIndex * width;
  }, [initialIndex, offset]);

  // Notify parent of index changes only when animation settles
  const handleIndexChange = (newIndex: number) => {
    if (newIndex !== index) {
      setIndex(newIndex);
      onIndexChange(newIndex);
    }
  };

  const pan = Gesture.Pan()
    .enabled(scrollEnabled)
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
      const maxOffset = (data.length - 1) * width;
      if (nextOffset > maxOffset) {
        // Apply resistance relative to the boundary
        const overscroll = nextOffset - maxOffset;
        nextOffset = maxOffset + overscroll * 0.5;
      }

      offset.value = nextOffset;
    })
    .onEnd((event) => {
      const currentPos = offset.value / width;
      const velocity = event.velocityX / width; // Normalize velocity
      
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
      const targetOffset = targetIndex * width;
      
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
    const left = -targetIndex * width;

    return (
      <View key={targetIndex} style={[styles.page, { left }]}>
        {renderItem({ item: data[targetIndex], index: targetIndex })}
      </View>
    );
  });

  return (
    <View style={styles.container}>
      <GestureDetector gesture={pan}>
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
    ...StyleSheet.absoluteFillObject,
    width,
    // Ensure pages don't shrink or grow unexpectedly
    flex: 0,
  },
});

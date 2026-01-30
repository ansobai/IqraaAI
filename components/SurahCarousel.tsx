import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Dimensions,
  View,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Pressable,
} from "react-native";
import SurahBanner from "./SurahBanner";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const ITEM_WIDTH = SCREEN_WIDTH / 3;

interface SurahItem {
  id: number;
  name: string;
}

interface Props {
  data: SurahItem[];
  onSelect: (id: number) => void;
  initialScrollIndex?: number;
}

export default function SurahCarousel({ data, onSelect, initialScrollIndex = 0 }: Props) {
  const flatListRef = useRef<FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(initialScrollIndex);
  const lastSelectedIdRef = useRef<number | null>(data[initialScrollIndex]?.id ?? null);

  const getIndexFromOffset = useCallback(
    (offsetX: number) => {
      const rawIndex = Math.round(offsetX / ITEM_WIDTH);
      return Math.max(0, Math.min(data.length - 1, rawIndex));
    },
    [data.length],
  );

  const selectIndex = useCallback(
    (index: number, options?: { force?: boolean }) => {
      const item = data[index];
      if (!item) return;
      if (!options?.force && lastSelectedIdRef.current === item.id) return;
      lastSelectedIdRef.current = item.id;
      onSelect(item.id);
    },
    [data, onSelect],
  );

  // Handle scroll to determine active index
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    // In inverted list, offset increases as we scroll left (to higher indices)
    const index = getIndexFromOffset(offsetX);
    setActiveIndex(index);
  };

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = getIndexFromOffset(offsetX);
    setActiveIndex(index);
  };

  // Scroll to initial index on mount if needed
  useEffect(() => {
    lastSelectedIdRef.current = data[initialScrollIndex]?.id ?? null;
    setActiveIndex(initialScrollIndex);

    if (flatListRef.current) {
      // We use a timeout to ensure layout is measured
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: initialScrollIndex,
          animated: false,
          viewPosition: 0.5,
        });
      }, 100);
    }
  }, [data, initialScrollIndex]);

  const getItemLayout = (_: any, index: number) => ({
    length: ITEM_WIDTH,
    offset: ITEM_WIDTH * index,
    index,
  });

  const renderItem = ({ item, index }: { item: SurahItem; index: number }) => {
    // Determine variant based on relative position to activeIndex
    // Note: This simplistic comparison depends on scroll updates.
    // Ideally, for smooth animations, we'd use Reanimated, but JS state is simpler for now.
    
    let variant: "default" | "left" | "right" = "default";
    let isActive = false;
    const isRightEdge = index === 0;

    if (index === activeIndex) {
      isActive = true;
      variant = "default";
    } else if (index === activeIndex - 1) {
      // Previous item (visually to the right in inverted RTL)
      variant = "right";
    } else if (index === activeIndex + 1) {
      // Next item (visually to the left in inverted RTL)
      variant = "left";
    } else {
      // Further items - default to appropriate side or just default?
      // User only mentioned 3 at once. Others might be partially visible or hidden.
      // If it's further away, we can just default them or hide them?
      // Let's stick to side variants if they are just off-screen to keep continuity
      variant = index < activeIndex ? "right" : "left";
    }

    if (isRightEdge && variant === "right") {
      variant = "default";
    }

    const shouldDeemphasize = !isActive && !isRightEdge;

    return (
      <Pressable
        onPress={() => selectIndex(index, { force: true })}
        style={{
          width: ITEM_WIDTH,
          alignItems: "center",
          justifyContent: "center",
          // Scale effect for active item could be nice, user asked for "middle one is current"
          transform: [{ scale: shouldDeemphasize ? 0.9 : 1 }],
          opacity: shouldDeemphasize ? 0.7 : 1,
        }}
      >
        <SurahBanner
          label={item.name}
          size="md"
          variant={variant}
          // The container style needs to ensure the banner fits within ITEM_WIDTH
          containerStyle={{
            width: "100%", // Fill the ITEM_WIDTH
          }}
          textStyle={{
            color: isActive ? "#2E8B57" : "#1F1F1F",
            fontWeight: isActive ? "bold" : "normal",
          }}
        />
      </Pressable>
    );
  };

  return (
    <View style={{ height: 80, width: SCREEN_WIDTH }}>
      <FlatList
        ref={flatListRef}
        data={data}
        keyExtractor={(item) => item.id.toString()}
        horizontal
        inverted
        showsHorizontalScrollIndicator={false}
        snapToInterval={ITEM_WIDTH}
        decelerationRate="fast"
        contentContainerStyle={{
          alignItems: "center",
        }}
        onScroll={onScroll}
        scrollEventThrottle={16} // 60fps
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        getItemLayout={getItemLayout}
        renderItem={renderItem}
        initialNumToRender={5}
      />
    </View>
  );
}

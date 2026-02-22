import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { toArabicNumber } from "../utils/toArabicNumbers";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const ITEM_WIDTH = SCREEN_WIDTH / 3;
const PILL_WIDTH = ITEM_WIDTH - 22;
const AUTO_NAV_DELAY_MS = 750;
const ACCENT_CYAN_GREEN = "#1F8E89";
const ACCENT_CYAN_GREEN_SOFT = "#E3F4F2";
const RAIL_BG = "#E3F4F2";
const RAIL_BORDER = "#BDDCD8";
const PILL_ACTIVE_BORDER = "#A9D1CD";
const PILL_INACTIVE_BORDER = "#C7E2DF";
const MUTED_DOT = "#8AB4B1";
const MUTED_TEXT = "#5C8482";
const ACTIVE_LABEL = "#1A6D69";
const INACTIVE_LABEL = "#406C6A";

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
  const clampedInitialIndex = Math.max(0, Math.min(data.length - 1, initialScrollIndex));

  const flatListRef = useRef<FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(clampedInitialIndex);
  const lastSelectedIdRef = useRef<number | null>(data[clampedInitialIndex]?.id ?? null);
  const activeIndexRef = useRef(clampedInitialIndex);
  const autoNavTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoNavTimer = useCallback(() => {
    if (!autoNavTimerRef.current) return;
    clearTimeout(autoNavTimerRef.current);
    autoNavTimerRef.current = null;
  }, []);

  const getIndexFromOffset = useCallback(
    (offsetX: number) => {
      // The carousel shows 3 items, so the middle item is one width past the offset.
      const rawIndex = Math.round(offsetX / ITEM_WIDTH + 1);
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

  const scheduleAutoNavigate = useCallback(
    (index: number) => {
      clearAutoNavTimer();
      autoNavTimerRef.current = setTimeout(() => {
        // Navigate only if the same item stayed centered long enough.
        if (activeIndexRef.current !== index) return;
        selectIndex(index);
      }, AUTO_NAV_DELAY_MS);
    },
    [clearAutoNavTimer, selectIndex],
  );

  const scrollToCenteredIndex = useCallback((index: number, animated = true) => {
    if (!flatListRef.current) return;
    flatListRef.current.scrollToIndex({
      index,
      animated,
      viewPosition: 0.5,
    });
  }, []);

  // Handle scroll to determine active index
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    // In inverted list, offset increases as we scroll left (to higher indices)
    const index = getIndexFromOffset(offsetX);
    activeIndexRef.current = index;
    setActiveIndex(index);
    scheduleAutoNavigate(index);
  };

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = getIndexFromOffset(offsetX);
    activeIndexRef.current = index;
    setActiveIndex(index);
    scheduleAutoNavigate(index);
  };

  // Scroll to initial index on mount if needed
  useEffect(() => {
    if (data.length === 0) {
      lastSelectedIdRef.current = null;
      activeIndexRef.current = 0;
      setActiveIndex(0);
      return;
    }

    lastSelectedIdRef.current = data[clampedInitialIndex]?.id ?? null;
    activeIndexRef.current = clampedInitialIndex;
    setActiveIndex(clampedInitialIndex);

    if (flatListRef.current) {
      // We use a timeout to ensure layout is measured
      setTimeout(() => {
        scrollToCenteredIndex(clampedInitialIndex, false);
      }, 100);
    }
  }, [clampedInitialIndex, data, scrollToCenteredIndex]);

  useEffect(() => () => clearAutoNavTimer(), [clearAutoNavTimer]);

  const getItemLayout = (_: any, index: number) => ({
    length: ITEM_WIDTH,
    offset: ITEM_WIDTH * index,
    index,
  });

  const renderItem = ({ item, index }: { item: SurahItem; index: number }) => {
    const isActive = index === activeIndex;
    const isNearActive = Math.abs(index - activeIndex) <= 1;
    const restingScale = isActive ? 1 : isNearActive ? 0.94 : 0.9;
    const restingOpacity = isActive ? 1 : isNearActive ? 0.84 : 0.65;

    return (
      <Pressable
        onPress={() => {
          clearAutoNavTimer();
          activeIndexRef.current = index;
          setActiveIndex(index);
          scrollToCenteredIndex(index);
          scheduleAutoNavigate(index);
        }}
        style={({ pressed }) => [
          styles.itemWrap,
          {
            width: ITEM_WIDTH,
            opacity: restingOpacity,
            transform: [
              {
                scale: pressed ? (isActive ? 0.98 : 0.93) : restingScale,
              },
            ],
          },
        ]}
      >
        <View
          style={[
            styles.pill,
            { width: PILL_WIDTH },
            isActive ? styles.pillActive : styles.pillInactive,
          ]}
        >
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.label, isActive ? styles.labelActive : styles.labelInactive]}
          >
            {item.name}
          </Text>
          <View style={styles.metaRow}>
            <View style={[styles.metaDot, isActive ? styles.metaDotActive : styles.metaDotInactive]} />
            <Text style={[styles.indexText, isActive ? styles.indexTextActive : styles.indexTextInactive]}>
              {toArabicNumber(item.id)}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.rail}>
        <FlatList
          ref={flatListRef}
          data={data}
          keyExtractor={(item) => item.id.toString()}
          horizontal
          inverted
          showsHorizontalScrollIndicator={false}
          snapToInterval={ITEM_WIDTH}
          decelerationRate="fast"
          contentContainerStyle={styles.listContent}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onMomentumScrollEnd={onScrollEnd}
          onScrollEndDrag={onScrollEnd}
          getItemLayout={getItemLayout}
          renderItem={renderItem}
          initialNumToRender={5}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 84,
    width: SCREEN_WIDTH,
    justifyContent: "center",
  },
  rail: {
    marginHorizontal: 18,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: RAIL_BORDER,
    backgroundColor: RAIL_BG,
    paddingVertical: 8,
  },
  listContent: {
    alignItems: "center",
    paddingHorizontal: 6,
  },
  itemWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    minHeight: 52,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  pillActive: {
    backgroundColor: "rgba(255,255,255,0.94)",
    borderColor: PILL_ACTIVE_BORDER,
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  pillInactive: {
    backgroundColor: "rgba(255,255,255,0.62)",
    borderColor: PILL_INACTIVE_BORDER,
  },
  metaRow: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
  },
  metaDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    marginRight: 5,
  },
  metaDotActive: {
    backgroundColor: ACCENT_CYAN_GREEN,
  },
  metaDotInactive: {
    backgroundColor: MUTED_DOT,
  },
  indexText: {
    fontFamily: "Scheherazade",
    fontSize: 11,
    lineHeight: 14,
  },
  indexTextActive: {
    color: ACCENT_CYAN_GREEN,
    fontWeight: "700",
  },
  indexTextInactive: {
    color: MUTED_TEXT,
  },
  label: {
    fontFamily: "Scheherazade",
    fontSize: 17,
    lineHeight: 22,
    writingDirection: "rtl",
    textAlign: "center",
  },
  labelActive: {
    color: ACTIVE_LABEL,
    fontWeight: "700",
    textShadowColor: ACCENT_CYAN_GREEN_SOFT,
    textShadowRadius: 2,
  },
  labelInactive: {
    color: INACTIVE_LABEL,
    fontWeight: "500",
  },
});

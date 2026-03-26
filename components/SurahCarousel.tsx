import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

const CHIP_WIDTH = 122;
const CHIP_HEIGHT = 55;
const ITEM_GAP = 12;
const ITEM_SIZE = CHIP_WIDTH + ITEM_GAP;

interface SurahItem {
  id: number;
  name: string;
}

interface Props {
  data: SurahItem[];
  onSelect: (id: number) => void;
  initialScrollIndex?: number;
  autoSelectOnMount?: boolean;
  tapSelectMode?: "immediate" | "dwell";
  swipeDwellMs?: number;
  variant?: "default" | "miniUnderline";
}

export default function SurahCarousel({
  data,
  onSelect,
  initialScrollIndex = 0,
  autoSelectOnMount = true,
  tapSelectMode = "dwell",
  swipeDwellMs = 2000,
  variant = "default",
}: Props) {
  const flatListRef = useRef<FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(initialScrollIndex);
  const [confirmedIndex, setConfirmedIndex] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const window = useWindowDimensions();
  const pulseValue = useRef(new Animated.Value(0)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionSourceRef = useRef<"sync" | "tap" | "swipe">("sync");
  const isUserDraggingRef = useRef(false);
  const lastCenteredWidthRef = useRef(0);
  const layoutWidth = containerWidth > 0 ? containerWidth : window.width;
  const sideInset = useMemo(
    () => Math.max(16, (layoutWidth - ITEM_SIZE) / 2),
    [layoutWidth],
  );

  const clearTimersAndPulse = useCallback(() => {
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    pulseLoopRef.current?.stop();
    pulseValue.setValue(0);
  }, [pulseValue]);

  const getIndexFromOffset = useCallback(
    (offsetX: number) => {
      const rawIndex = Math.round(offsetX / ITEM_SIZE);
      return Math.max(0, Math.min(data.length - 1, rawIndex));
    },
    [data.length],
  );

  const scrollToCenteredIndex = useCallback(
    (index: number, animated = true) => {
      if (!flatListRef.current) return;
      flatListRef.current.scrollToIndex({
        index,
        animated,
        viewPosition: 0.5,
      });
    },
    [],
  );

  const onScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = event.nativeEvent.contentOffset.x;
      const index = getIndexFromOffset(offsetX);
      const isUserDrivenScroll = isUserDraggingRef.current;
      if (isUserDraggingRef.current) {
        selectionSourceRef.current = "swipe";
        isUserDraggingRef.current = false;
      }
      // Ignore passive/programmatic end events while synced from parent state.
      // This prevents a stale offset reading from shifting highlight to the previous chip.
      if (!isUserDrivenScroll && selectionSourceRef.current === "sync") {
        return;
      }
      setActiveIndex(index);
    },
    [getIndexFromOffset],
  );

  useEffect(() => {
    selectionSourceRef.current = "sync";
    setActiveIndex(initialScrollIndex);

    if (flatListRef.current) {
      setTimeout(() => {
        scrollToCenteredIndex(initialScrollIndex, false);
      }, 100);
    }
  }, [data, initialScrollIndex, scrollToCenteredIndex]);

  useEffect(() => {
    if (!flatListRef.current || containerWidth <= 0) return;
    if (lastCenteredWidthRef.current === containerWidth) return;
    lastCenteredWidthRef.current = containerWidth;
    // When width/padding settles after mount, keep the selected chip centered.
    setTimeout(() => {
      scrollToCenteredIndex(activeIndex, false);
    }, 0);
  }, [activeIndex, containerWidth, scrollToCenteredIndex]);

  useEffect(() => {
    const item = data[activeIndex];
    if (!item) return;

    clearTimersAndPulse();
    setConfirmedIndex(null);

    const source = selectionSourceRef.current;

    if (source === "sync" && !autoSelectOnMount) {
      return;
    }

    if (source === "tap" && tapSelectMode === "immediate") {
      onSelect(item.id);
      return;
    }

    if (variant === "default") {
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseValue, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(pulseValue, {
            toValue: 0,
            duration: 700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
        ]),
      );
      pulseLoopRef.current.start();
    }

    dwellTimerRef.current = setTimeout(() => {
      pulseLoopRef.current?.stop();
      setConfirmedIndex(activeIndex);
      confirmTimerRef.current = setTimeout(() => {
        onSelect(item.id);
      }, 220);
    }, swipeDwellMs);

    return () => {
      clearTimersAndPulse();
    };
  }, [
    activeIndex,
    autoSelectOnMount,
    clearTimersAndPulse,
    data,
    onSelect,
    pulseValue,
    swipeDwellMs,
    tapSelectMode,
    variant,
  ]);

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: ITEM_SIZE,
      // Include horizontal inset so scrollToIndex/viewPosition target is accurate.
      offset: sideInset + ITEM_SIZE * index,
      index,
    }),
    [sideInset],
  );

  const renderItem = ({ item, index }: { item: SurahItem; index: number }) => {
    const isActive = index === activeIndex;
    const isConfirmed = index === confirmedIndex;
    const pulsingBackground = pulseValue.interpolate({
      inputRange: [0, 1],
      outputRange: ["#B9DEE9", "#A7D6E4"],
    });
    const pulsingUnderline = pulseValue.interpolate({
      inputRange: [0, 1],
      outputRange: ["#255A6D", "#3A7D94"],
    });

    if (variant === "miniUnderline") {
      return (
        <Pressable
          onPress={() => {
            selectionSourceRef.current = "tap";
            setActiveIndex(index);
            scrollToCenteredIndex(index);
          }}
          style={({ pressed }) => [
            styles.itemWrap,
            styles.miniItemWrap,
            { width: ITEM_SIZE, opacity: pressed ? 0.82 : 1 },
          ]}
        >
          <View style={styles.miniLabelWrap}>
            <Text
              numberOfLines={1}
              style={[
                styles.nameText,
                styles.miniNameText,
                isActive ? styles.miniActiveText : styles.miniInactiveText,
                isConfirmed && styles.miniConfirmedText,
              ]}
            >
              {item.name}
            </Text>
            <Animated.View
              style={[
                styles.miniUnderline,
                isActive ? styles.miniActiveUnderline : styles.miniInactiveUnderline,
                isActive &&
                  !isConfirmed && { backgroundColor: pulsingUnderline },
                isConfirmed && styles.miniConfirmedUnderline,
              ]}
            />
          </View>
        </Pressable>
      );
    }

    return (
      <Pressable
        onPress={() => {
          selectionSourceRef.current = "tap";
          setActiveIndex(index);
          scrollToCenteredIndex(index);
        }}
        style={({ pressed }) => [
          styles.itemWrap,
          { width: ITEM_SIZE, opacity: pressed ? 0.9 : 1 },
        ]}
      >
        <Animated.View
          style={[
            styles.chip,
            !isActive && styles.inactiveChip,
            isActive && !isConfirmed && styles.activeChip,
            isActive && !isConfirmed && { backgroundColor: pulsingBackground },
            isConfirmed && styles.confirmedChip,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.nameText,
              isConfirmed
                ? styles.confirmedText
                : isActive
                  ? styles.activeText
                  : styles.inactiveText,
            ]}
          >
            {item.name}
          </Text>
        </Animated.View>
      </Pressable>
    );
  };

  return (
    <View
      style={styles.container}
      onLayout={(event) => {
        const nextWidth = Math.round(event.nativeEvent.layout.width);
        if (nextWidth > 0 && nextWidth !== containerWidth) {
          setContainerWidth(nextWidth);
        }
      }}
    >
      <FlatList
        ref={flatListRef}
        data={data}
        keyExtractor={(item) => item.id.toString()}
        horizontal
        inverted
        showsHorizontalScrollIndicator={false}
        snapToInterval={ITEM_SIZE}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={{
          alignItems: "center",
          paddingHorizontal: sideInset,
        }}
        onScrollBeginDrag={() => {
          isUserDraggingRef.current = true;
        }}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        getItemLayout={getItemLayout}
        renderItem={renderItem}
        initialNumToRender={5}
        maxToRenderPerBatch={10}
        windowSize={7}
        onScrollToIndexFailed={(info) => {
          const safeIndex = Math.max(0, Math.min(info.index, data.length - 1));
          setTimeout(() => scrollToCenteredIndex(safeIndex, false), 60);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 84,
    width: "100%",
    justifyContent: "center",
  },
  itemWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    width: CHIP_WIDTH,
    height: CHIP_HEIGHT,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  activeChip: {
    shadowColor: "#1E4A5D",
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  inactiveChip: {
    backgroundColor: "#E6F3F7",
  },
  confirmedChip: {
    backgroundColor: "#9CCDAA",
    shadowColor: "#2F6B43",
    shadowOpacity: 0.18,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  nameText: {
    fontFamily: "Scheherazade",
    fontSize: 28,
    lineHeight: 40,
    paddingTop: 4,
    textAlign: "center",
    writingDirection: "rtl",
  },
  activeText: {
    color: "#255A6D",
  },
  inactiveText: {
    color: "#7C8285",
  },
  confirmedText: {
    color: "#1F4D30",
  },
  miniItemWrap: {
    justifyContent: "flex-end",
    paddingBottom: 10,
  },
  miniLabelWrap: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: CHIP_WIDTH,
  },
  miniNameText: {
    lineHeight: 38,
    fontSize: 24,
    paddingTop: 0,
    marginBottom: 8,
  },
  miniInactiveText: {
    color: "#5F7886",
  },
  miniActiveText: {
    color: "#255A6D",
  },
  miniConfirmedText: {
    color: "#255A6D",
  },
  miniUnderline: {
    width: 84,
    height: 2,
    borderRadius: 999,
  },
  miniInactiveUnderline: {
    backgroundColor: "#C8E3EF",
  },
  miniActiveUnderline: {
    height: 3,
    backgroundColor: "#255A6D",
  },
  miniConfirmedUnderline: {
    height: 3,
    backgroundColor: "#255A6D",
  },
});

import React from "react";
import { FlatList, Pressable, View } from "react-native";

import SurahBanner from "./SurahBanner";

type SurahItem = {
  id: number;
  name: string;
};

type Props = {
  data: SurahItem[];
  onSelect: (id: number) => void;
  activeSurahId?: number;
  initialScrollIndex?: number;
};

export default function SurahCarousel({
  data,
  onSelect,
  activeSurahId,
  initialScrollIndex = 0,
}: Props) {
  const safeInitialIndex = Math.max(
    0,
    Math.min(data.length - 1, initialScrollIndex),
  );
  const resolvedInitialIndex = data.length > 0 ? safeInitialIndex : undefined;

  return (
    <View className="h-16">
      <FlatList
        data={data}
        keyExtractor={(item) => item.id.toString()}
        horizontal
        showsHorizontalScrollIndicator={false}
        inverted
        initialScrollIndex={resolvedInitialIndex}
        getItemLayout={(_, index) => ({
          length: 116,
          offset: 116 * index,
          index,
        })}
        contentContainerStyle={{ paddingHorizontal: 20, alignItems: "center" }}
        renderItem={({ item }) => {
          const isActive = item.id === activeSurahId;

          return (
            <Pressable
              onPress={() => onSelect(item.id)}
              style={({ pressed }) => [
                {
                  transform: [{ scale: pressed ? 0.95 : 1 }],
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
              className="ml-3"
            >
              <SurahBanner
                label={item.name}
                size="md"
                textStyle={{ color: isActive ? "#2E8B57" : "#1F1F1F" }}
              />
            </Pressable>
          );
        }}
      />
    </View>
  );
}

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import PagerView from "react-native-pager-view";
import QuranPage from "./QuranPage";

type PageSelectedEvent = {
  nativeEvent: {
    position: number;
  };
};

export interface QuranReaderProps {
  pages: number[];
  pageIndex: number;
  onPageIndexChange: (index: number) => void;
  highlightedVerseId?: string;
  renderWindow?: number;
  hideSideMarkers?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function QuranReader({
  pages,
  pageIndex,
  onPageIndexChange,
  highlightedVerseId,
  renderWindow = 1,
  hideSideMarkers = false,
  style,
}: QuranReaderProps) {
  const pagerRef = useRef<PagerView>(null);

  const safeIndex = useMemo(() => {
    if (!pages.length) return 0;
    return Math.max(0, Math.min(pageIndex, pages.length - 1));
  }, [pageIndex, pages.length]);

  useEffect(() => {
    if (!pages.length) return;
    pagerRef.current?.setPageWithoutAnimation(safeIndex);
  }, [safeIndex, pages.length]);

  const handlePageSelected = useCallback(
    (event: PageSelectedEvent) => {
      const nextIndex = event.nativeEvent.position;
      if (nextIndex !== pageIndex) {
        onPageIndexChange(nextIndex);
      }
    },
    [pageIndex, onPageIndexChange]
  );

  return (
    <PagerView
      ref={pagerRef}
      style={[styles.pager, style]}
      initialPage={safeIndex}
      offscreenPageLimit={Math.max(1, renderWindow)}
      onPageSelected={handlePageSelected}
    >
      {pages.map((pageNumber, index) => {
        const shouldRender = Math.abs(index - safeIndex) <= renderWindow;

        return (
          <View key={pageNumber} style={styles.page}>
            <QuranPage
              pageNumber={pageNumber}
              highlightedVerseId={shouldRender ? highlightedVerseId : undefined}
              shouldRender={shouldRender}
              hideSideMarkers={hideSideMarkers}
            />
          </View>
        );
      })}
    </PagerView>
  );
}

const styles = StyleSheet.create({
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
});

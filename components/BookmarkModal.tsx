import { Ionicons } from "@expo/vector-icons";
import { Asset } from "expo-asset";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgXml } from "react-native-svg";

import { ARABIC_SURAHS } from "../constants/surahNames";
import { useBookmarks, type Bookmark } from "../hooks/useBookmarks";
import { getSurahIdForPageNumber } from "../utils/mushafData";
import { toArabicNumber } from "../utils/toArabicNumbers";

const BOOKMARK_ICON = require("../assets/images/bookmark-icon.svg");

const loadSvgAssetXml = async (moduleId: number): Promise<string | null> => {
  try {
    const asset = Asset.fromModule(moduleId);
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    if (!uri) return null;
    const response = await fetch(uri);
    return await response.text();
  } catch (error) {
    console.error("Failed to load SVG asset:", error);
    return null;
  }
};

const formatBookmarkDate = (dateString: string, isRTL: boolean) => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
};

type BookmarkModalProps = {
  visible: boolean;
  onClose: () => void;
  currentPageNumber?: number | null;
};

export default function BookmarkModal({
  visible,
  onClose,
  currentPageNumber,
}: BookmarkModalProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isRTL = true;
  const rowDirection = styles.rowReverse;

  const { bookmarks, isLoading, addBookmark, removeBookmark } = useBookmarks();
  const [bookmarkXml, setBookmarkXml] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const loadIcon = async () => {
      const xml = await loadSvgAssetXml(BOOKMARK_ICON);
      if (!isActive) return;
      const tinted = xml ? xml.replace("<path", '<path fill="#2E9BA7"') : null;
      setBookmarkXml(tinted);
    };

    loadIcon();

    return () => {
      isActive = false;
    };
  }, []);

  const handleAddCurrent = useCallback(() => {
    if (!currentPageNumber) return;
    const surahId = getSurahIdForPageNumber(currentPageNumber) ?? 1;
    addBookmark({ surahId, pageNumber: currentPageNumber });
  }, [addBookmark, currentPageNumber]);

  const handleNavigate = useCallback(
    (bookmark: Bookmark) => {
      router.replace({
        pathname: "/(surahs)/[surahId]",
        params: {
          surahId: String(bookmark.surahId),
          page: String(bookmark.pageNumber),
        },
      });
      onClose();
    },
    [onClose, router],
  );

  const header = useMemo(
    () => (
      <View>
        <Pressable
          onPress={handleAddCurrent}
          disabled={!currentPageNumber}
          style={({ pressed }) => [
            styles.addButton,
            !currentPageNumber && styles.addButtonDisabled,
            pressed && styles.addButtonPressed,
          ]}
        >
          <View style={[styles.addButtonContent, rowDirection]}>
            <Ionicons
              name="add"
              size={20}
              color="#1E4F54"
              style={styles.addButtonIcon}
            />
            <Text
              className="font-uthmanic"
              style={[
                styles.addButtonText,
                isRTL ? styles.textRight : styles.textLeft,
              ]}
            >
              اضافة علامة للصفحة الحالية
            </Text>
          </View>
        </Pressable>
        <Text
          className="font-uthmanic"
          style={[
            styles.sectionLabel,
            isRTL ? styles.textRight : styles.textLeft,
          ]}
        >
          Recent Bookmarks
        </Text>
      </View>
    ),
    [currentPageNumber, handleAddCurrent, rowDirection],
  );

  const renderItem = useCallback(
    ({ item }: { item: Bookmark }) => {
      const surahName = ARABIC_SURAHS[item.surahId] ?? "";
      const formattedDate = formatBookmarkDate(item.createdAt, isRTL);

      return (
        <Pressable
          onPress={() => handleNavigate(item)}
          style={({ pressed }) => [
            styles.bookmarkRow,
            rowDirection,
            pressed && styles.bookmarkRowPressed,
          ]}
        >
          <View style={[styles.iconShell, isRTL && styles.iconShellRtl]}>
            <View style={styles.iconBadge}>
              {bookmarkXml ? (
                <SvgXml xml={bookmarkXml} width={18} height={18} />
              ) : null}
            </View>
          </View>
          <View style={styles.bookmarkContent}>
            <View style={[styles.titleRow, rowDirection]}>
              <Text
                className="font-uthmanic"
                style={[
                  styles.surahTitle,
                  isRTL ? styles.textRight : styles.textLeft,
                ]}
              >
                سورة {surahName}
              </Text>
            </View>
            <View style={[styles.metaRow, rowDirection]}>
              <Text
                className="font-uthmanic"
                style={[
                  styles.metaText,
                  styles.metaPageText,
                  isRTL ? styles.textRight : styles.textLeft,
                ]}
              >
                {"\u0635\u0641\u062d\u0629"}{" "}
                <Text style={styles.pageNumberText}>
                  {toArabicNumber(item.pageNumber)}
                </Text>
              </Text>
              {formattedDate ? (
                <Text
                  className="font-uthmanic"
                  style={[
                    styles.metaText,
                    styles.metaDateText,
                    isRTL ? styles.textLeft : styles.textRight,
                  ]}
                >
                  {formattedDate}
                </Text>
              ) : null}
            </View>
          </View>
          <View
            style={[
              styles.rowActions,
              isRTL && styles.rowActionsRtl,
              rowDirection,
            ]}
          >
            <Pressable
              onPress={() => removeBookmark(item.id)}
              style={({ pressed }) => [
                styles.iconButton,
                pressed && styles.iconButtonPressed,
              ]}
            >
              <Ionicons name="close" size={18} color="#7A7A7A" />
            </Pressable>
            <Ionicons
              name={isRTL ? "chevron-back" : "chevron-forward"}
              size={18}
              color="#B0B0B0"
            />
          </View>
        </Pressable>
      );
    },
    [bookmarkXml, handleNavigate, isRTL, removeBookmark, rowDirection],
  );

  const emptyState = useMemo(() => {
    if (isLoading) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator color="#2E9BA7" />
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <Text
          className="font-uthmanic"
          style={[styles.emptyText, isRTL ? styles.textRight : styles.textLeft]}
        >
          لا توجد علامات مرجعية بعد
        </Text>
      </View>
    );
  }, [isLoading]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <TouchableWithoutFeedback>
          <View
            style={[
              styles.sheet,
              {
                marginTop: insets.top + 24,
                marginBottom: insets.bottom + 24,
              },
            ]}
          >
            <View style={[styles.header, rowDirection]}>
              <Text
                className="font-uthmanic"
                style={[
                  styles.headerTitle,
                  isRTL ? styles.textRight : styles.textLeft,
                ]}
              >
                العلامات المرجعية
              </Text>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && styles.closeButtonPressed,
                ]}
              >
                <Ionicons name="close" size={18} color="#6B6B6B" />
              </Pressable>
            </View>
            <FlatList
              data={bookmarks}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              ListHeaderComponent={header}
              ListEmptyComponent={emptyState}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          </View>
        </TouchableWithoutFeedback>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 17, 20, 0.35)",
    paddingHorizontal: 18,
    justifyContent: "flex-start",
  },
  sheet: {
    backgroundColor: "#FAF9F6",
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
    flex: 1,
  },
  header: {
    alignItems: "center",
    justifyContent: "space-between",
    flexDirection: "row",
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 20,
    color: "#1F2A2E",
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#EEF2F3",
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  addButton: {
    backgroundColor: "#AED9E0",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
    shadowColor: "#7FBEC7",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  addButtonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  addButtonDisabled: {
    opacity: 0.6,
  },
  addButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonIcon: {
    marginHorizontal: 6,
  },
  addButtonText: {
    fontSize: 16,
    color: "#1E4F54",
  },
  sectionLabel: {
    fontSize: 12,
    color: "#8B8F91",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  listContent: {
    paddingBottom: 16,
  },
  bookmarkRow: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#ECE6DA",
    flexDirection: "row",
    alignItems: "center",
  },
  bookmarkRowPressed: {
    transform: [{ scale: 0.99 }],
    backgroundColor: "#F6F3EE",
  },
  iconShell: {
    marginRight: 12,
    marginLeft: 0,
  },
  iconShellRtl: {
    marginLeft: 12,
    marginRight: 0,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#E9F6F8",
    alignItems: "center",
    justifyContent: "center",
  },
  bookmarkContent: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  surahTitle: {
    fontSize: 20,
    color: "#1E2A2E",
  },
  metaText: {
    fontSize: 16,
    color: "#7A7F82",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaPageText: {
    flexShrink: 1,
  },
  metaDateText: {
    flexShrink: 0,
  },
  pageNumberText: {
    fontFamily: Platform.select({
      ios: "System",
      android: "sans-serif",
      default: "System",
    }),
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 8,
  },
  rowActionsRtl: {
    marginRight: 8,
    marginLeft: 0,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#F2F2F2",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 6,
  },
  iconButtonPressed: {
    opacity: 0.7,
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: "#7A7F82",
    fontSize: 14,
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  textRight: {
    textAlign: "right",
  },
  textLeft: {
    textAlign: "left",
  },
});

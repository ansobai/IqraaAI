import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from "react-native";
import { Circle, Rect, Svg } from "react-native-svg";

import { toArabicNumber } from "../utils/toArabicNumbers";
import { type QuoteVerseSelection } from "../utils/quoteVerseMapping";

type QuotePreviewModalProps = {
  visible: boolean;
  quote: QuoteVerseSelection | null;
  onClose: () => void;
  onPlayVerse: (quote: QuoteVerseSelection) => void;
  isVerseAudioLoading: boolean;
  onPreviousVerse?: () => void;
  onNextVerse?: () => void;
  canGoPreviousVerse?: boolean;
  canGoNextVerse?: boolean;
};

const SURAH_PREFIX = "سورة";
const DOWNLOAD_LABEL = "تحميل";
const PREVIEW_LABEL = "معاينة";
const LISTEN_LABEL = "استماع";
const SAVE_LABEL = "حفظ";
const SHARE_LABEL = "مشاركة";
const AYAH_END_MARKER = "\u06DD";
const WAQF_MARKER_SPLIT_REGEX = /([\uFBBF\u06DF])/u;
const WAQF_MARKER_TOKEN_REGEX = /^[\uFBBF\u06DF]$/u;

const stripTrailingAyahMarker = (verseText: string) =>
  verseText
    .replace(
      /(?:\s*\u06DD\s*[0-9\u0660-\u0669\u06F0-\u06F9]*\s*)+$/u,
      "",
    )
    .trimEnd();

const normalizeVerseTextForDisplay = (verseText: string) =>
  verseText.normalize("NFC");

export default function QuotePreviewModal({
  visible,
  quote,
  onClose,
  onPlayVerse,
  isVerseAudioLoading,
  onPreviousVerse,
  onNextVerse,
  canGoPreviousVerse = false,
  canGoNextVerse = false,
}: QuotePreviewModalProps) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const isVisible = visible && quote != null;

  if (!quote) return null;

  const headerLabel = `${SURAH_PREFIX} ${quote.surahName}`;
  const numericVerse = Number(quote.verseNumber);
  const verseNumberLabel = Number.isFinite(numericVerse)
    ? toArabicNumber(numericVerse)
    : quote.verseNumber;

  const cleanVerseText = stripTrailingAyahMarker(quote.verseText);
  const verseDisplayText = normalizeVerseTextForDisplay(cleanVerseText);
  const verseDisplayParts = verseDisplayText
    .split(WAQF_MARKER_SPLIT_REGEX)
    .filter((part) => part.length > 0);

  const verseCharacterCount = cleanVerseText.length;
  const isCompactHeight = windowHeight < 760;
  const baseVerseFontSize = isCompactHeight ? 34 : 40;
  const scaledVerseFontSize =
    verseCharacterCount > 220
      ? baseVerseFontSize - 10
      : verseCharacterCount > 170
        ? baseVerseFontSize - 7
        : verseCharacterCount > 120
          ? baseVerseFontSize - 5
          : verseCharacterCount > 85
            ? baseVerseFontSize - 2
            : baseVerseFontSize;

  const verseFontSize = Math.max(27, scaledVerseFontSize);
  const verseLineHeightMultiplier = Platform.select({
    ios: 1.74,
    android: 1.68,
    default: 1.72,
  });
  const verseLineHeight = Math.round(verseFontSize * verseLineHeightMultiplier);

  const cardWidth = Math.min(windowWidth - 34, 620);
  const cardMaxHeight = Math.min(windowHeight * 0.93, 940);
  const verseAreaMaxHeight = Math.min(Math.max(windowHeight * 0.47, 220), 430);
  const showVerseNavigation = Boolean(onPreviousVerse || onNextVerse);

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <TouchableWithoutFeedback>
          <View style={[styles.card, { width: cardWidth, maxHeight: cardMaxHeight }]}>
            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={30} color="#7D8EA1" />
            </Pressable>

            <ScrollView
              style={styles.contentScroll}
              contentContainerStyle={styles.contentScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.bannerWrap}>
                <View style={styles.surahHeaderShell}>
                  <Svg
                    width="100%"
                    height="100%"
                    viewBox="0 0 960 190"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    <Rect x="0" y="26" width="960" height="138" rx="8" fill="#BFE8F2" />
                    <Rect x="190" y="37" width="580" height="116" rx="58" fill="#FFFFFF" />
                    <Circle cx="190" cy="84" r="28" fill="#FFFFFF" />
                    <Circle cx="190" cy="114" r="24" fill="#FFFFFF" />
                    <Circle cx="770" cy="84" r="28" fill="#FFFFFF" />
                    <Circle cx="770" cy="114" r="24" fill="#FFFFFF" />
                    <Rect x="0" y="22" width="960" height="4" fill="#F2EEE4" />
                    <Rect x="0" y="164" width="960" height="4" fill="#F2EEE4" />
                  </Svg>

                  <View pointerEvents="none" style={styles.surahHeaderTextWrap}>
                    <View style={styles.surahHeaderTextFrame}>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.72}
                        style={styles.surahHeaderText}
                      >
                        {headerLabel}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={[styles.verseSection, { maxHeight: verseAreaMaxHeight }]}>
                <ScrollView
                  style={styles.verseScroll}
                  contentContainerStyle={styles.verseScrollContent}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                >
                  <Text
                    style={[
                      styles.verseText,
                      {
                        fontSize: verseFontSize,
                        lineHeight: verseLineHeight,
                      },
                    ]}
                  >
                    {verseDisplayParts.map((part, index) =>
                      WAQF_MARKER_TOKEN_REGEX.test(part) ? (
                        <Text
                          key={`waqf-${index}`}
                          style={[
                            styles.waqfMarker,
                            {
                              fontSize: Math.round(verseFontSize * 0.84),
                              lineHeight: verseLineHeight,
                            },
                          ]}
                        >
                          {part}
                        </Text>
                      ) : (
                        <Text key={`verse-${index}`}>{part}</Text>
                      ),
                    )}
                    <Text style={styles.verseAyahMarkerText}> {AYAH_END_MARKER}</Text>
                    <Text style={styles.verseNumberText}>{verseNumberLabel}</Text>
                  </Text>
                </ScrollView>
              </View>
            </ScrollView>

            <View style={styles.separator} />

            <View style={styles.mainActionsRow}>
              {showVerseNavigation ? (
                <Pressable
                  style={styles.navActionWrap}
                  onPress={onNextVerse}
                  disabled={!canGoNextVerse}
                  accessibilityRole="button"
                  accessibilityLabel="Next verse"
                >
                  <View
                    style={[
                      styles.navActionCircle,
                      !canGoNextVerse && styles.navActionCircleDisabled,
                    ]}
                  >
                    <Ionicons
                      name="arrow-back"
                      size={24}
                      color={canGoNextVerse ? "#77BFD0" : "#C1DCE6"}
                    />
                  </View>
                </Pressable>
              ) : null}

              <ActionButton label={DOWNLOAD_LABEL} icon="download" onPress={() => {}} />
              <ActionButton label={PREVIEW_LABEL} icon="eye" onPress={() => {}} />
              <ActionButton
                label={LISTEN_LABEL}
                icon={isVerseAudioLoading ? "download" : "play"}
                onPress={() => onPlayVerse(quote)}
              />

              {showVerseNavigation ? (
                <Pressable
                  style={styles.navActionWrap}
                  onPress={onPreviousVerse}
                  disabled={!canGoPreviousVerse}
                  accessibilityRole="button"
                  accessibilityLabel="Previous verse"
                >
                  <View
                    style={[
                      styles.navActionCircle,
                      !canGoPreviousVerse && styles.navActionCircleDisabled,
                    ]}
                  >
                    <Ionicons
                      name="arrow-forward"
                      size={24}
                      color={canGoPreviousVerse ? "#77BFD0" : "#C1DCE6"}
                    />
                  </View>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.secondaryActionsRow}>
              <Text style={styles.secondaryActionText}>{SAVE_LABEL}</Text>
              <Text style={styles.secondaryActionText}>{SHARE_LABEL}</Text>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Pressable>
    </Modal>
  );
}

type ActionButtonProps = {
  label: string;
  icon: "play" | "eye" | "download";
  onPress: () => void;
};

function ActionButton({ label, icon, onPress }: ActionButtonProps) {
  return (
    <Pressable onPress={onPress} style={styles.actionWrap}>
      <View style={styles.actionCircle}>
        <Ionicons name={icon} size={22} color="#77BFD0" />
      </View>
      <Text numberOfLines={1} style={styles.actionLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(28, 34, 43, 0.46)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
  },
  card: {
    borderRadius: 40,
    backgroundColor: "#FCFDFC",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
    overflow: "hidden",
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderWidth: 1,
    borderColor: "#E7EEF2",
  },
  closeButton: {
    position: "absolute",
    left: 18,
    top: 16,
    zIndex: 2,
  },
  contentScroll: {
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    marginTop: 38,
  },
  contentScrollContent: {
    paddingBottom: 12,
  },
  bannerWrap: {
    alignItems: "center",
  },
  surahHeaderShell: {
    width: "100%",
    maxWidth: 580,
    height: 94,
    position: "relative",
  },
  surahHeaderTextWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  surahHeaderTextFrame: {
    width: "63%",
    alignItems: "center",
    justifyContent: "center",
  },
  surahHeaderText: {
    fontFamily: "Scheherazade",
    color: "#17263A",
    fontSize: 34,
    lineHeight: 40,
    textAlign: "center",
    writingDirection: "rtl",
    includeFontPadding: false,
    width: "100%",
  },
  verseSection: {
    marginTop: 10,
    borderRadius: 22,
    backgroundColor: "#EAF6FB",
    borderWidth: 1,
    borderColor: "#D5E9F1",
    padding: 12,
  },
  verseScroll: {
    flexGrow: 0,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  verseScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
  verseText: {
    fontFamily: Platform.select({
      ios: "UthmanicHafs",
      android: "Madani",
      default: "UthmanicHafs",
    }),
    color: "#111C31",
    textAlign: "center",
    writingDirection: "rtl",
    includeFontPadding: true,
  },
  waqfMarker: {
    fontFamily: "Amiri",
    color: "#111C31",
  },
  verseNumberText: {
    fontFamily: "Amiri",
    color: "#111C31",
  },
  verseAyahMarkerText: {
    fontFamily: Platform.select({
      ios: "UthmanicHafs",
      android: "Madani",
      default: "UthmanicHafs",
    }),
    color: "#111C31",
  },
  separator: {
    height: 1,
    backgroundColor: "#E6EFF3",
    marginTop: 10,
    marginBottom: 14,
  },
  mainActionsRow: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 4,
  },
  navActionWrap: {
    width: 52,
    alignItems: "center",
    paddingTop: 6,
  },
  navActionCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "#C8E2EB",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FCFE",
  },
  navActionCircleDisabled: {
    borderColor: "#DEEAF0",
    backgroundColor: "#FBFDFE",
  },
  actionWrap: {
    alignItems: "center",
    width: 84,
  },
  actionCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: "#C8E2EB",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FCFE",
  },
  actionLabel: {
    fontFamily: "Amiri",
    marginTop: 10,
    fontSize: 16,
    lineHeight: 22,
    color: "#51637A",
    textAlign: "center",
    writingDirection: "rtl",
  },
  secondaryActionsRow: {
    marginTop: 20,
    flexDirection: "row-reverse",
    justifyContent: "space-around",
    paddingHorizontal: 22,
  },
  secondaryActionText: {
    fontFamily: "Amiri",
    fontSize: 22,
    lineHeight: 30,
    color: "#5A6C83",
  },
});

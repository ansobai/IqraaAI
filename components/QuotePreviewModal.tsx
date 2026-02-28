import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from "react-native";

import type { QuoteVerseSelection } from "../utils/quoteVerseMapping";
import { fetchMuyassarTafsir } from "../utils/tafsirApi";
import { toArabicNumber } from "../utils/toArabicNumbers";

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

const TAFSIR_SOURCE = "\u2013 \u0627\u0644\u062a\u0641\u0633\u064a\u0631 \u0627\u0644\u0645\u064a\u0633\u0631";
const TAFSIR_LOADING_TEXT =
  "\u062c\u0627\u0631\u064a \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u062a\u0641\u0633\u064a\u0631...";
const TAFSIR_ERROR_TEXT =
  "\u062a\u062d\u062a\u0627\u062c \u0625\u0644\u0649 \u0627\u062a\u0635\u0627\u0644 \u0628\u0627\u0644\u0625\u0646\u062a\u0631\u0646\u062a \u0644\u0639\u0631\u0636 \u0627\u0644\u062a\u0641\u0633\u064a\u0631.";
const SURAH_PREFIX = "\u0633\u0648\u0631\u0629";

const stripTrailingAyahMarker = (verseText: string) =>
  verseText.replace(/\s*\u06DD\s*[0-9\u0660-\u0669]*\s*$/u, "").trimEnd();

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
  const [activeMode, setActiveMode] = useState<"tafsir" | "preview">("tafsir");
  const [tafsirText, setTafsirText] = useState<string | null>(null);
  const [isTafsirLoading, setIsTafsirLoading] = useState(false);
  const [tafsirError, setTafsirError] = useState<string | null>(null);
  const selectedSurahId = quote?.surahId;
  const selectedVerseNumber = quote?.verseNumber;

  useEffect(() => {
    if (visible) {
      setActiveMode("tafsir");
    }
  }, [visible, quote?.verseNumber]);

  useEffect(() => {
    if (!visible || selectedSurahId == null || selectedVerseNumber == null) {
      setTafsirText(null);
      setTafsirError(null);
      setIsTafsirLoading(false);
      return;
    }

    const abortController = new AbortController();

    setIsTafsirLoading(true);
    setTafsirError(null);
    setTafsirText(null);

    fetchMuyassarTafsir({
      surahId: selectedSurahId,
      verseNumber: selectedVerseNumber,
      signal: abortController.signal,
    })
      .then((text) => {
        if (!abortController.signal.aborted) {
          setTafsirText(text);
        }
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) return;

        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        setTafsirError(TAFSIR_ERROR_TEXT);
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsTafsirLoading(false);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [selectedSurahId, selectedVerseNumber, visible]);

  const isVisible = visible && quote != null;
  if (!quote) return null;
  const headerLabel = `${SURAH_PREFIX} ${quote.surahName}`;
  const numericVerse = Number(quote.verseNumber);
  const verseNumberLabel = Number.isFinite(numericVerse)
    ? toArabicNumber(numericVerse)
    : quote.verseNumber;
  const cleanVerseText = stripTrailingAyahMarker(quote.verseText);
  const verseWithMarker = `${cleanVerseText} \u06DD${verseNumberLabel}`;
  const verseCharacterCount = cleanVerseText.length;
  const isCompactHeight = windowHeight < 760;
  const baseVerseFontSize = isCompactHeight ? 42 : 52;
  const scaledVerseFontSize =
    verseCharacterCount > 140
      ? baseVerseFontSize - 10
      : verseCharacterCount > 95
        ? baseVerseFontSize - 6
        : baseVerseFontSize;
  const verseFontSize = Math.max(30, scaledVerseFontSize);
  const verseLineHeight = Math.round(verseFontSize * 1.45);
  const cardWidth = Math.min(windowWidth - 44, 620);
  const cardMaxHeight = Math.min(windowHeight * 0.9, 900);
  const isPreviewMode = activeMode === "preview";
  const showTafsir = activeMode === "tafsir" || isPreviewMode;
  const showBottomActions = !isPreviewMode;
  const showVerseNavigation = Boolean(onPreviousVerse || onNextVerse);

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <TouchableWithoutFeedback>
          <View style={[styles.card, { width: cardWidth, maxHeight: cardMaxHeight }]}>
            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={30} color="#8E98A8" />
            </Pressable>

            {isPreviewMode ? (
              <Pressable
                style={styles.previewDownloadButton}
                onPress={() => {}}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="\u062a\u062d\u0645\u064a\u0644"
              >
                <View style={styles.previewDownloadIconWrap}>
                  <Ionicons name="download" size={24} color="#8E98A8" />
                </View>
              </Pressable>
            ) : null}

            <ScrollView
              style={styles.contentScroll}
              contentContainerStyle={styles.contentScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.bannerWrap}>
                <View style={styles.surahBanner}>
                  <Text className="font-uthmanic" style={styles.surahBannerText}>
                    {headerLabel}
                  </Text>
                </View>
              </View>

              <View style={styles.contentWrap}>
                <Text
                  className="font-uthmanic"
                  style={[
                    styles.verseText,
                    {
                      fontSize: verseFontSize,
                      lineHeight: verseLineHeight,
                    },
                  ]}
                >
                  {verseWithMarker}
                </Text>
              </View>

              {showTafsir ? (
                <View style={styles.tafsirSection}>
                  {isTafsirLoading ? (
                    <Text className="font-uthmanic" style={styles.tafsirText}>
                      {TAFSIR_LOADING_TEXT}
                    </Text>
                  ) : null}
                  {!isTafsirLoading && tafsirError ? (
                    <Text className="font-uthmanic" style={styles.tafsirText}>
                      {tafsirError}
                    </Text>
                  ) : null}
                  {!isTafsirLoading && !tafsirError && tafsirText ? (
                    <Text className="font-uthmanic" style={styles.tafsirText}>
                      {tafsirText}
                    </Text>
                  ) : null}
                  {!isPreviewMode && !isTafsirLoading && !tafsirError && tafsirText ? (
                    <Text className="font-uthmanic" style={styles.sourceText}>
                      {TAFSIR_SOURCE}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>

            {showBottomActions ? (
              <>
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
                          color={canGoNextVerse ? "#95C7D4" : "#C9DCE6"}
                        />
                      </View>
                    </Pressable>
                  ) : null}
                  <ActionButton
                    label="\u062a\u062d\u0645\u064a\u0644"
                    icon="download"
                    onPress={() => {}}
                  />
                  <ActionButton
                    label="\u0645\u0639\u0627\u064a\u0646\u0629"
                    icon="eye"
                    active={false}
                    onPress={() => setActiveMode("preview")}
                  />
                  <ActionButton
                    label="\u0627\u0633\u062a\u0645\u0627\u0639"
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
                          color={canGoPreviousVerse ? "#95C7D4" : "#C9DCE6"}
                        />
                      </View>
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.secondaryActionsRow}>
                  <Text style={styles.secondaryActionText}>{"\u062d\u0641\u0638"}</Text>
                  <Text style={styles.secondaryActionText}>{"\u0645\u0634\u0627\u0631\u0643\u0629"}</Text>
                </View>
              </>
            ) : null}
          </View>
        </TouchableWithoutFeedback>
      </Pressable>
    </Modal>
  );
}

type ActionButtonProps = {
  label: string;
  icon: "play" | "eye" | "download";
  active?: boolean;
  onPress: () => void;
};

function ActionButton({ label, icon, active = false, onPress }: ActionButtonProps) {
  return (
    <Pressable onPress={onPress} style={styles.actionWrap}>
      <View style={[styles.actionCircle, active && styles.actionCircleActive]}>
        <Ionicons
          name={icon}
          size={active ? 24 : 22}
          color={active ? "#FFFFFF" : "#95C7D4"}
        />
      </View>
      <Text className="font-uthmanic" style={[styles.actionLabel, active && styles.actionLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(37, 44, 55, 0.44)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 22,
  },
  card: {
    borderRadius: 40,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
    overflow: "hidden",
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  closeButton: {
    position: "absolute",
    left: 18,
    top: 16,
    zIndex: 2,
  },
  previewDownloadButton: {
    position: "absolute",
    right: 18,
    top: 16,
    zIndex: 2,
  },
  previewDownloadIconWrap: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  contentScroll: {
    flexShrink: 1,
    marginTop: 40,
  },
  contentScrollContent: {
    paddingBottom: 12,
  },
  bannerWrap: {
    alignItems: "center",
  },
  surahBanner: {
    width: "100%",
    maxWidth: 460,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#CFD7E2",
    backgroundColor: "#F6F8FB",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  surahBannerText: {
    color: "#384053",
    fontSize: 24,
    lineHeight: 34,
    textAlign: "center",
    writingDirection: "rtl",
  },
  contentWrap: {
    paddingHorizontal: 8,
    paddingTop: 14,
    paddingBottom: 10,
  },
  verseText: {
    color: "#0A1328",
    textAlign: "center",
    writingDirection: "rtl",
  },
  tafsirSection: {
    marginTop: 6,
    marginHorizontal: 2,
    borderRadius: 20,
    backgroundColor: "#EEF4FB",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  tafsirText: {
    fontSize: 21,
    lineHeight: 38,
    color: "#48536A",
    textAlign: "right",
    writingDirection: "rtl",
  },
  sourceText: {
    marginTop: 6,
    fontSize: 17,
    lineHeight: 28,
    color: "#7D8AA0",
    textAlign: "right",
    writingDirection: "rtl",
  },
  previewHint: {
    fontSize: 22,
    lineHeight: 34,
    color: "#7F8A99",
    textAlign: "center",
    writingDirection: "rtl",
    marginTop: 10,
    marginBottom: 18,
  },
  separator: {
    height: 1,
    backgroundColor: "#EDF1F4",
    marginTop: 12,
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
    borderColor: "#D2EAF0",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  navActionCircleDisabled: {
    borderColor: "#E6EFF5",
  },
  actionWrap: {
    alignItems: "center",
    width: 72,
  },
  actionCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: "#D2EAF0",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  actionCircleActive: {
    backgroundColor: "#A8DDEA",
    borderColor: "#A8DDEA",
  },
  actionLabel: {
    marginTop: 10,
    fontSize: 15,
    color: "#5A6678",
  },
  actionLabelActive: {
    color: "#102038",
    fontWeight: "700",
  },
  secondaryActionsRow: {
    marginTop: 20,
    flexDirection: "row-reverse",
    justifyContent: "space-around",
    paddingHorizontal: 22,
  },
  secondaryActionText: {
    fontFamily: "UthmanicHafs",
    fontSize: 30,
    color: "#6A7487",
  },
});

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
import { fetchJalalaynTafsir } from "../utils/tafsirApi";
import { toArabicNumber } from "../utils/toArabicNumbers";

type QuotePreviewModalProps = {
  visible: boolean;
  quote: QuoteVerseSelection | null;
  onClose: () => void;
  onPreviousVerse?: () => void;
  onNextVerse?: () => void;
  canGoPreviousVerse?: boolean;
  canGoNextVerse?: boolean;
};

const TAFSIR_SOURCE = "\u2013 \u062a\u0641\u0633\u064a\u0631 \u0627\u0644\u062c\u0644\u0627\u0644\u064a\u0646";
const TAFSIR_LOADING_TEXT =
  "\u062c\u0627\u0631\u064a \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u062a\u0641\u0633\u064a\u0631...";
const TAFSIR_ERROR_TEXT =
  "\u062a\u062d\u062a\u0627\u062c \u0625\u0644\u0649 \u0627\u062a\u0635\u0627\u0644 \u0628\u0627\u0644\u0625\u0646\u062a\u0631\u0646\u062a \u0644\u0639\u0631\u0636 \u0627\u0644\u062a\u0641\u0633\u064a\u0631.";
const SURAH_PREFIX = "\u0633\u0648\u0631\u0629";
const ACTION_LABEL_DOWNLOAD = "\u062a\u062d\u0645\u064a\u0644";
const ACTION_LABEL_PREVIEW = "\u0645\u0639\u0627\u064a\u0646\u0629";
const ACTION_LABEL_LISTEN = "\u0627\u0633\u062a\u0645\u0627\u0639";
const SECONDARY_LABEL_SAVE = "\u062d\u0641\u0638";
const SECONDARY_LABEL_SHARE = "\u0645\u0634\u0627\u0631\u0643\u0629";
const CARD_MIN_HEIGHT = 520;
const CARD_MAX_HEIGHT = 760;
const CARD_HEIGHT_RATIO = 0.78;
const CARD_SCREEN_MARGIN = 32;

const TRAILING_AYAH_MARKER_REGEX =
  /[\s\u200E\u200F]*\u06DD[\s\u200E\u200F]*[0-9\u0660-\u0669]*[\s\u200E\u200F]*$/u;

const stripTrailingAyahMarker = (verseText: string) => {
  let normalizedText = verseText.trimEnd();

  // Some sources include duplicated trailing ayah markers; remove all of them before appending one.
  while (TRAILING_AYAH_MARKER_REGEX.test(normalizedText)) {
    normalizedText = normalizedText.replace(TRAILING_AYAH_MARKER_REGEX, "").trimEnd();
  }

  return normalizedText;
};

export default function QuotePreviewModal({
  visible,
  quote,
  onClose,
  onPreviousVerse,
  onNextVerse,
  canGoPreviousVerse = false,
  canGoNextVerse = false,
}: QuotePreviewModalProps) {
  const { height: viewportHeight } = useWindowDimensions();
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

    fetchJalalaynTafsir({
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
  const verseWithMarker = `${stripTrailingAyahMarker(quote.verseText)} \u06DD${verseNumberLabel}`;
  const isPreviewMode = activeMode === "preview";
  const showTafsir = activeMode === "tafsir" || isPreviewMode;
  const showBottomActions = !isPreviewMode;
  const showVerseNavigation = Boolean(onPreviousVerse || onNextVerse);
  const targetCardHeight = Math.min(
    CARD_MAX_HEIGHT,
    Math.max(CARD_MIN_HEIGHT, Math.round(viewportHeight * CARD_HEIGHT_RATIO)),
  );
  const cardHeight = Math.min(
    targetCardHeight,
    Math.max(0, Math.round(viewportHeight - CARD_SCREEN_MARGIN)),
  );

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <TouchableWithoutFeedback>
          <View style={[styles.card, { height: cardHeight }]}>
            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={30} color="#8E98A8" />
            </Pressable>

            {isPreviewMode ? (
              <Pressable
                style={styles.previewDownloadButton}
                onPress={() => {}}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={ACTION_LABEL_DOWNLOAD}
              >
                <View style={styles.previewDownloadIconWrap}>
                  <Ionicons name="download" size={24} color="#8E98A8" />
                </View>
              </Pressable>
            ) : null}

            <Text className="font-uthmanic" style={styles.headerText}>
              {headerLabel}
            </Text>

            <View style={styles.body}>
              <ScrollView
                style={styles.textScroll}
                contentContainerStyle={styles.textScrollContent}
                showsVerticalScrollIndicator
              >
                <View style={styles.contentWrap}>
                  <Text className="font-uthmanic" style={styles.verseText}>
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
            </View>

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
                    label={ACTION_LABEL_DOWNLOAD}
                    icon="download"
                    onPress={() => {}}
                  />
                  <ActionButton
                    label={ACTION_LABEL_PREVIEW}
                    icon="eye"
                    active={false}
                    onPress={() => setActiveMode("preview")}
                  />
                  <ActionButton
                    label={ACTION_LABEL_LISTEN}
                    icon="play"
                    onPress={() => {}}
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
                  <Text style={styles.secondaryActionText}>{SECONDARY_LABEL_SAVE}</Text>
                  <Text style={styles.secondaryActionText}>{SECONDARY_LABEL_SHARE}</Text>
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
    width: "100%",
    maxWidth: 620,
    borderRadius: 40,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
    overflow: "hidden",
    paddingTop: 26,
    paddingHorizontal: 22,
    paddingBottom: 26,
  },
  body: {
    flex: 1,
    minHeight: 0,
    marginTop: 6,
  },
  textScroll: {
    flex: 1,
  },
  textScrollContent: {
    paddingBottom: 8,
  },
  headerText: {
    alignSelf: "center",
    marginTop: 18,
    fontSize: 24,
    color: "#5F6775",
    textAlign: "center",
    writingDirection: "rtl",
  },
  closeButton: {
    position: "absolute",
    left: 24,
    top: 26,
    zIndex: 2,
  },
  previewDownloadButton: {
    position: "absolute",
    right: 24,
    top: 26,
    zIndex: 2,
  },
  previewDownloadIconWrap: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  contentWrap: {
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 14,
  },
  verseText: {
    fontSize: 60,
    lineHeight: 100,
    color: "#0A1328",
    textAlign: "center",
    writingDirection: "rtl",
  },
  tafsirSection: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 8,
  },
  tafsirText: {
    fontSize: 18,
    lineHeight: 39,
    color: "#768093",
    textAlign: "center",
    writingDirection: "rtl",
  },
  sourceText: {
    marginTop: 4,
    fontSize: 18,
    lineHeight: 30,
    color: "#AAB2C0",
    textAlign: "center",
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

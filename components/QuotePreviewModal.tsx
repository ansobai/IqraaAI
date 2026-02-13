import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from "react-native";

import { toArabicNumber } from "../utils/toArabicNumbers";
import type { QuoteVerseSelection } from "../utils/quoteVerseMapping";
import SurahBanner from "./SurahBanner";

type QuotePreviewModalProps = {
  visible: boolean;
  quote: QuoteVerseSelection | null;
  onClose: () => void;
};

const SURAH_PREFIX = "\u0633\u0648\u0631\u0629";
const FALLBACK_TAFSIR =
  "\u00ab\u0625\u0650\u0646\u064e\u0651 \u0627\u0644\u0644\u064e\u0647\u064e \u0648\u064e\u0645\u064e\u0644\u064e\u0627\u0626\u0650\u0643\u064e\u062a\u064e\u0647\u064f \u064a\u064f\u0635\u064e\u0644\u064f\u0651\u0648\u0646\u064e \u0639\u064e\u0644\u064e\u0649 \u0627\u0644\u0646\u064e\u0651\u0628\u0650\u064a\u0650\u0651\u00bb \u0645\u062d\u0645\u062f \u0635\u0644\u0649 \u0627\u0644\u0644\u0647 \u0639\u0644\u064a\u0647 \u0648\u0633\u0644\u0645\u060c \u0648\u0642\u064a\u0644\u064e: \u0627\u0644\u0645\u0639\u0646\u0649 \u064a\u064f\u0628\u0627\u0631\u0643\u0648\u0646 \u0639\u0644\u064a\u0647 \u00ab\u064a\u0627 \u0623\u064a\u0647\u0627 \u0627\u0644\u0630\u064a\u0646 \u0622\u0645\u0646\u0648\u0627 \u0635\u0644\u0648\u0627 \u0639\u0644\u064a\u0647 \u0648\u0633\u0644\u0645\u0648\u0627 \u062a\u0633\u0644\u064a\u0645\u064b\u0627\u00bb \u0623\u064a \u0642\u0648\u0644\u0648\u0627: \u0627\u0644\u0644\u0647\u0645 \u0635\u0644\u0651\u0650 \u0639\u0644\u0649 \u0645\u062d\u0645\u062f\u064d \u0648\u0633\u0644\u0651\u0650\u0645.";
const TAFSIR_SOURCE = "\u2013 \u062a\u0641\u0633\u064a\u0631 \u0627\u0644\u062c\u0644\u0627\u0644\u064a\u0646";

const resolveVerseNumberLabel = (verseNumber: string) => {
  const numeric = Number(verseNumber);
  if (Number.isFinite(numeric)) {
    return toArabicNumber(numeric);
  }

  return verseNumber;
};

export default function QuotePreviewModal({
  visible,
  quote,
  onClose,
}: QuotePreviewModalProps) {
  const [activeMode, setActiveMode] = useState<"tafsir" | "preview">("tafsir");
  useEffect(() => {
    if (visible) {
      setActiveMode("tafsir");
    }
  }, [visible, quote?.verseNumber]);

  const isVisible = visible && quote != null;
  if (!quote) return null;
  const verseNumber = resolveVerseNumberLabel(quote.verseNumber);
  const headerLabel = `${SURAH_PREFIX} ${quote.surahName} \u00b7 ${verseNumber}`;
  const showTafsir = activeMode === "tafsir";

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <TouchableWithoutFeedback>
          <View style={styles.card}>
            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={30} color="#8E98A8" />
            </Pressable>

            <SurahBanner label={headerLabel} size="sm" containerStyle={styles.banner} />

            <View style={styles.contentWrap}>
              <Text className="font-uthmanic" style={styles.verseText}>
                {quote.verseText}
              </Text>
            </View>

            {showTafsir ? (
              <View style={styles.tafsirSection}>
                <Text className="font-uthmanic" style={styles.tafsirText}>
                  {FALLBACK_TAFSIR}
                </Text>
                <Text className="font-uthmanic" style={styles.sourceText}>
                  {TAFSIR_SOURCE}
                </Text>
              </View>
            ) : (
              <Text className="font-uthmanic" style={styles.previewHint}>
                {"\u0645\u0639\u0627\u064a\u0646\u0629 \u0627\u0644\u0622\u064a\u0629"}
              </Text>
            )}

            <View style={styles.separator} />

            <View style={styles.mainActionsRow}>
              <ActionButton
                label="\u0627\u0633\u062a\u0645\u0627\u0639"
                icon="play"
                onPress={() => {}}
              />
              <ActionButton
                label="\u062a\u0641\u0633\u064a\u0631"
                icon="book"
                active={activeMode === "tafsir"}
                onPress={() => setActiveMode("tafsir")}
              />
              <ActionButton
                label="\u0645\u0639\u0627\u064a\u0646\u0629"
                icon="eye"
                active={activeMode === "preview"}
                onPress={() => setActiveMode("preview")}
              />
              <ActionButton
                label="\u062d\u0641\u0638"
                icon="download"
                onPress={() => {}}
              />
            </View>

            <View style={styles.secondaryActionsRow}>
              <Text style={styles.secondaryActionText}>
                {"\u0645\u0631\u062c\u0639\u064a\u0629"}
              </Text>
              <Text style={styles.secondaryActionText}>
                {"\u0645\u0634\u0627\u0631\u0643\u0629"}
              </Text>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Pressable>
    </Modal>
  );
}

type ActionButtonProps = {
  label: string;
  icon: "play" | "book" | "eye" | "download";
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
    minHeight: 560,
  },
  banner: {
    alignSelf: "center",
    marginTop: 18,
  },
  closeButton: {
    position: "absolute",
    left: 24,
    top: 26,
    zIndex: 2,
  },
  contentWrap: {
    paddingHorizontal: 12,
    paddingTop: 18,
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
    paddingHorizontal: 4,
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

import React from "react";
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
const AYAH_PREFIX = "\u0627\u0644\u0622\u064a\u0629";

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
  const isVisible = visible && quote != null;
  if (!quote) return null;

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <TouchableWithoutFeedback>
          <View style={styles.card}>
            <SurahBanner
              label={`${SURAH_PREFIX} ${quote.surahName}`}
              size="lg"
              containerStyle={styles.banner}
            />

            <View style={styles.contentWrap}>
              <Text className="font-uthmanic" style={styles.verseText}>
                {quote.verseText}
              </Text>
            </View>

            <Text className="font-uthmanic" style={styles.metaText}>
              {`${AYAH_PREFIX} ${resolveVerseNumberLabel(quote.verseNumber)}`}
            </Text>
          </View>
        </TouchableWithoutFeedback>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.42)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 24,
    backgroundColor: "#FFFAF2",
    borderWidth: 1,
    borderColor: "#E8DCC6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 10,
    overflow: "hidden",
    paddingBottom: 18,
  },
  banner: {
    marginHorizontal: 14,
    marginTop: 14,
  },
  contentWrap: {
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  verseText: {
    fontSize: 38,
    lineHeight: 66,
    color: "#1F1F1F",
    textAlign: "center",
    writingDirection: "rtl",
  },
  metaText: {
    fontSize: 20,
    lineHeight: 30,
    color: "#8F7E5E",
    textAlign: "center",
    writingDirection: "rtl",
  },
});

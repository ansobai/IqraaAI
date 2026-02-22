import React, { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { TasmeeWordState } from "../types/tasmee";
import type { MushafLineWord, MushafPageLines } from "../utils/mushafData";

type TasmeeToken = {
  text: string;
  charType: string;
  wordIndex: number | null;
  revealWithWordIndex: number | null;
};

type TasmeeLine = {
  lineNumber: number;
  tokens: TasmeeToken[];
};

const TOTAL_LINE_SLOTS = 15;
const PAGE_BACKGROUND_COLOR = "#FFFAF2";

export interface TasmeePageProps {
  pageData: MushafPageLines | null;
  wordStates: TasmeeWordState[];
}

const toTasmeeLines = (pageData: MushafPageLines): TasmeeLine[] => {
  let wordCursor = 0;
  let lastWordIndex: number | null = null;

  return pageData.lines.map((line) => {
    const tokens: TasmeeToken[] = line.words.map((word: MushafLineWord) => {
      if (word.charType === "word") {
        const token: TasmeeToken = {
          text: word.text,
          charType: word.charType,
          wordIndex: wordCursor,
          revealWithWordIndex: wordCursor,
        };
        lastWordIndex = wordCursor;
        wordCursor += 1;
        return token;
      }

      return {
        text: word.text,
        charType: word.charType,
        wordIndex: null,
        revealWithWordIndex: word.charType === "end" ? lastWordIndex : null,
      };
    });

    return {
      lineNumber: line.lineNumber,
      tokens,
    };
  });
};

const isVisibleState = (state: TasmeeWordState | undefined) =>
  state === "revealed_correct" || state === "visible_static";

function TasmeePage({ pageData, wordStates }: TasmeePageProps) {
  const lineMap = useMemo(() => {
    if (!pageData) return new Map<number, TasmeeLine>();
    return new Map<number, TasmeeLine>(
      toTasmeeLines(pageData).map((line) => [line.lineNumber, line]),
    );
  }, [pageData]);

  const lineSlots = useMemo(
    () =>
      Array.from({ length: TOTAL_LINE_SLOTS }, (_, index) => {
        const lineNumber = index + 1;
        return lineMap.get(lineNumber) ?? null;
      }),
    [lineMap],
  );

  return (
    <View style={styles.container}>
      <View style={styles.linesContainer}>
        {lineSlots.map((line, slotIndex) => (
          <View key={`tasmee-line-${slotIndex + 1}`} style={styles.lineSlot}>
            {line ? (
              <View style={styles.tokenRow}>
                {line.tokens.map((token, tokenIndex) => {
                  let isVisible = false;
                  if (token.wordIndex != null) {
                    isVisible = isVisibleState(wordStates[token.wordIndex]);
                  } else if (token.revealWithWordIndex != null) {
                    isVisible = isVisibleState(
                      wordStates[token.revealWithWordIndex],
                    );
                  }

                  return (
                    <Text
                      key={`${line.lineNumber}-${tokenIndex}`}
                      style={[styles.tokenText, !isVisible && styles.hiddenTokenText]}
                    >
                      {token.text}
                    </Text>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.placeholderText}>{"\u00A0"}</Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PAGE_BACKGROUND_COLOR,
  },
  linesContainer: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
  },
  lineSlot: {
    flex: 1,
    justifyContent: "center",
    alignItems: "stretch",
  },
  tokenRow: {
    flexDirection: "row-reverse",
    flexWrap: "nowrap",
    justifyContent: "flex-start",
    alignItems: "center",
  },
  tokenText: {
    color: "#1F1F1F",
    fontFamily: "UthmanicHafs",
    fontSize: 20,
    lineHeight: 34,
    marginHorizontal: 1.5,
    textAlign: "right",
    writingDirection: "rtl",
  },
  hiddenTokenText: {
    color: "transparent",
  },
  placeholderText: {
    color: "transparent",
    fontFamily: "UthmanicHafs",
    fontSize: 20,
    lineHeight: 34,
    textAlign: "right",
    writingDirection: "rtl",
  },
});

export default memo(TasmeePage);

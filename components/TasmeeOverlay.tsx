import React, { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { TasmeeWordState } from "../types/tasmee";
import type { MushafPageLines, MushafLineWord } from "../utils/mushafData";

type OverlayToken = {
  text: string;
  charType: string;
  wordIndex: number | null;
};

type OverlayLine = {
  lineNumber: number;
  tokens: OverlayToken[];
};

export interface TasmeeOverlayProps {
  pageData: MushafPageLines | null;
  isLocked: boolean;
  wordStates: TasmeeWordState[];
}

const estimatePlaceholderWidth = (wordText: string) =>
  Math.max(16, Math.min(110, wordText.length * 9));

const toOverlayLines = (pageData: MushafPageLines): OverlayLine[] => {
  let wordCursor = 0;

  return pageData.lines.map((line) => {
    const tokens: OverlayToken[] = line.words.map((word: MushafLineWord) => {
      if (word.charType !== "word") {
        return {
          text: word.text,
          charType: word.charType,
          wordIndex: null,
        };
      }

      const token: OverlayToken = {
        text: word.text,
        charType: word.charType,
        wordIndex: wordCursor,
      };
      wordCursor += 1;
      return token;
    });

    return {
      lineNumber: line.lineNumber,
      tokens,
    };
  });
};

function TasmeeOverlay({ pageData, isLocked, wordStates }: TasmeeOverlayProps) {
  const overlayLines = useMemo(
    () => (pageData ? toOverlayLines(pageData) : []),
    [pageData],
  );

  if (!isLocked || !pageData) return null;

  return (
    <View pointerEvents="none" style={styles.container}>
      {overlayLines.map((line) => (
        <View key={`line-${line.lineNumber}`} style={styles.line}>
          {line.tokens.map((token, tokenIndex) => {
            if (token.wordIndex == null || token.charType !== "word") {
              return (
                <Text key={`${line.lineNumber}-${tokenIndex}`} style={styles.marker}>
                  {token.text}
                </Text>
              );
            }

            const state = wordStates[token.wordIndex] ?? "hidden_pending";
            if (state === "hidden_pending") {
              return (
                <View
                  key={`${line.lineNumber}-${tokenIndex}`}
                  style={[
                    styles.hiddenWord,
                    {
                      width: estimatePlaceholderWidth(token.text),
                    },
                  ]}
                />
              );
            }

            return (
              <Text
                key={`${line.lineNumber}-${tokenIndex}`}
                style={[
                  styles.word,
                  state === "revealed_correct"
                    ? styles.wordRevealed
                    : styles.wordStatic,
                ]}
              >
                {token.text}
              </Text>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: "rgba(255, 253, 245, 0.96)",
    justifyContent: "center",
  },
  line: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    alignItems: "center",
    marginBottom: 6,
  },
  word: {
    fontFamily: "UthmanicHafs",
    fontSize: 19,
    marginHorizontal: 2,
    marginVertical: 2,
  },
  wordStatic: {
    color: "#6D5B3F",
  },
  wordRevealed: {
    color: "#1F1F1F",
  },
  marker: {
    fontFamily: "UthmanicHafs",
    fontSize: 17,
    color: "#907449",
    marginHorizontal: 2,
    marginVertical: 2,
  },
  hiddenWord: {
    height: 20,
    borderRadius: 5,
    backgroundColor: "#D8C8A9",
    marginHorizontal: 2,
    marginVertical: 2,
    opacity: 0.85,
  },
});

export default memo(TasmeeOverlay);

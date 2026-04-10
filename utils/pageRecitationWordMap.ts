import type { MushafPage, MushafPageLines } from "./mushafData";
import {
  buildPageVerseQueue,
  formatVerseMapKey,
  type QuranRecitationVerse,
} from "./quranRecitationAudio";

export type PageVerseWordIndexMap = Map<string, number[]>;

const getVerseForCursor = (
  verseQueue: QuranRecitationVerse[],
  cursor: number,
): QuranRecitationVerse | null => {
  if (!verseQueue.length) return null;
  const clampedCursor = Math.max(0, Math.min(cursor, verseQueue.length - 1));
  return verseQueue[clampedCursor] ?? null;
};

export const buildPageVerseWordIndexMap = (
  page: MushafPage | null | undefined,
  pageLines: MushafPageLines | null | undefined,
): PageVerseWordIndexMap => {
  const map: PageVerseWordIndexMap = new Map();
  if (!page || !pageLines) return map;

  const verseQueue = buildPageVerseQueue(page);
  if (!verseQueue.length) return map;

  for (const verse of verseQueue) {
    const verseKey = formatVerseMapKey(verse.surahId, verse.verseNumber);
    if (!map.has(verseKey)) {
      map.set(verseKey, []);
    }
  }

  let verseCursor = 0;
  let globalWordIndex = 0;

  const sortedLines = [...pageLines.lines].sort(
    (left, right) => left.lineNumber - right.lineNumber,
  );

  for (const line of sortedLines) {
    for (const token of line.words) {
      if (token.charType === "word") {
        const verse = getVerseForCursor(verseQueue, verseCursor);
        if (verse) {
          const verseKey = formatVerseMapKey(verse.surahId, verse.verseNumber);
          const verseWordIndexes = map.get(verseKey);
          if (verseWordIndexes) {
            verseWordIndexes.push(globalWordIndex);
          } else {
            map.set(verseKey, [globalWordIndex]);
          }
        }
        globalWordIndex += 1;
      }

      if (token.charType === "end" && verseCursor < verseQueue.length - 1) {
        verseCursor += 1;
      }
    }
  }

  return map;
};

export const resolvePageRecitationWordIndex = (
  verseWordMap: PageVerseWordIndexMap,
  currentVerse: QuranRecitationVerse | null,
  currentWordInVerse: number | null,
): number | null => {
  if (!currentVerse) return null;
  if (currentWordInVerse == null || !Number.isFinite(currentWordInVerse)) {
    return null;
  }

  const normalizedWordInVerse = Math.trunc(currentWordInVerse);
  if (normalizedWordInVerse < 0) return null;

  const verseKey = formatVerseMapKey(
    currentVerse.surahId,
    currentVerse.verseNumber,
  );
  const verseWordIndexes = verseWordMap.get(verseKey);
  if (!verseWordIndexes?.length) return null;
  if (normalizedWordInVerse >= verseWordIndexes.length) return null;
  return verseWordIndexes[normalizedWordInVerse] ?? null;
};

import type { MushafPage, MushafPageLines } from "./mushafData";

type PageVerse = {
  surahId: number;
  surahName: string;
  verseNumber: string;
  verseText: string;
};

export type QuoteVerseSelection = {
  surahId: number;
  surahName: string;
  verseNumber: string;
  verseText: string;
  pageNumber: number;
  lineNumber: number;
};

export type QuoteWordToken = {
  tokenIndex: number;
  lineNumber: number;
  text: string;
  charStart: number;
  charLength: number;
} & PageVerse;

export type QuoteLineMapping = {
  lineNumber: number;
  lineCharTotal: number;
  wordTokens: QuoteWordToken[];
};

export type QuoteTokenLayout = {
  tokenIndex: number;
  x: number;
  width: number;
};

type ResolveQuoteFromLinePressArgs = {
  line: QuoteLineMapping;
  locationX: number;
  lineWidth: number;
  pageNumber: number;
  tokenLayouts?: QuoteTokenLayout[];
};

const TASHKEEL_REGEX = /[\u064B-\u065F\u0670]/g;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const estimateTokenLength = (tokenText: string) => {
  if (!tokenText) return 1;

  const noWhitespace = tokenText.replace(/\s+/g, "");
  if (!noWhitespace) return 1;

  const stripped = noWhitespace.replace(TASHKEEL_REGEX, "");
  return Math.max(1, stripped.length || noWhitespace.length);
};

const buildPageVerseSequence = (page: MushafPage): PageVerse[] =>
  page.surahs.flatMap((surah) => {
    const surahId = Number(surah.chapterNumber);
    const safeSurahId = Number.isFinite(surahId) ? surahId : 1;
    const surahName = surah.titleAr?.trim() || "";

    return surah.text.map((verse) => ({
      surahId: safeSurahId,
      surahName,
      verseNumber: String(verse.verseNumber ?? ""),
      verseText: verse.text ?? "",
    }));
  });

const toQuoteSelection = (
  token: QuoteWordToken,
  pageNumber: number,
): QuoteVerseSelection => ({
  surahId: token.surahId,
  surahName: token.surahName,
  verseNumber: token.verseNumber,
  verseText: token.verseText,
  pageNumber,
  lineNumber: token.lineNumber,
});

export const buildQuoteLineMappings = (
  page: MushafPage | null | undefined,
  pageLines: MushafPageLines | null | undefined,
): QuoteLineMapping[] => {
  if (!page || !pageLines) return [];

  const verseSequence = buildPageVerseSequence(page);
  if (!verseSequence.length) return [];

  let verseCursor = 0;

  const sortedLines = [...pageLines.lines].sort(
    (left, right) => left.lineNumber - right.lineNumber,
  );

  const mappings: QuoteLineMapping[] = [];

  for (const line of sortedLines) {
    let lineCharCursor = 0;
    let tokenIndex = 0;
    const wordTokens: QuoteWordToken[] = [];

    for (const token of line.words) {
      const tokenLength = estimateTokenLength(token.text);

      if (token.charType === "word") {
        const verse = verseSequence[Math.min(verseCursor, verseSequence.length - 1)];

        wordTokens.push({
          tokenIndex,
          lineNumber: line.lineNumber,
          text: token.text,
          charStart: lineCharCursor,
          charLength: tokenLength,
          surahId: verse.surahId,
          surahName: verse.surahName,
          verseNumber: verse.verseNumber,
          verseText: verse.verseText,
        });
        tokenIndex += 1;
      }

      lineCharCursor += tokenLength;

      if (token.charType === "end" && verseCursor < verseSequence.length - 1) {
        verseCursor += 1;
      }
    }

    if (wordTokens.length === 0) continue;

    mappings.push({
      lineNumber: line.lineNumber,
      lineCharTotal: Math.max(1, lineCharCursor),
      wordTokens,
    });
  }

  return mappings;
};

export const resolveQuoteFromLinePress = ({
  line,
  locationX,
  lineWidth,
  pageNumber,
  tokenLayouts,
}: ResolveQuoteFromLinePressArgs): QuoteVerseSelection | null => {
  if (!line.wordTokens.length) return null;

  const safeLineWidth = Math.max(1, lineWidth);
  const clampedX = clamp(locationX, 0, safeLineWidth);

  if (tokenLayouts?.length) {
    const layoutByTokenIndex = new Map<number, QuoteTokenLayout>();

    tokenLayouts.forEach((layout) => {
      if (!Number.isFinite(layout.x) || !Number.isFinite(layout.width)) return;
      if (layout.width <= 0) return;
      layoutByTokenIndex.set(layout.tokenIndex, layout);
    });

    if (layoutByTokenIndex.size === line.wordTokens.length) {
      let nearestMeasuredToken: QuoteWordToken | null = null;
      let nearestMeasuredDistance = Number.POSITIVE_INFINITY;

      for (const token of line.wordTokens) {
        const layout = layoutByTokenIndex.get(token.tokenIndex);
        if (!layout) continue;

        const center = layout.x + layout.width / 2;
        const distance = Math.abs(clampedX - center);
        if (distance < nearestMeasuredDistance) {
          nearestMeasuredDistance = distance;
          nearestMeasuredToken = token;
        }
      }

      if (nearestMeasuredToken) {
        return toQuoteSelection(nearestMeasuredToken, pageNumber);
      }
    }
  }

  const charTarget = (clampedX / safeLineWidth) * line.lineCharTotal;

  let nearestToken = line.wordTokens[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const token of line.wordTokens) {
    const tokenCenter = token.charStart + token.charLength / 2;
    const distance = Math.abs(tokenCenter - charTarget);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestToken = token;
    }
  }

  return toQuoteSelection(nearestToken, pageNumber);
};

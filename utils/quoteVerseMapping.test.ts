import assert from "node:assert/strict";
import test from "node:test";

import type { MushafPage, MushafPageLines } from "./mushafData";
import {
  buildQuoteLineMappings,
  resolveQuoteFromLinePress,
} from "./quoteVerseMapping";

const buildSingleSurahPage = (): MushafPage => ({
  pageNumber: 10,
  juzNumber: 1,
  surahs: [
    {
      chapterNumber: 2,
      titleAr: "Al-Baqarah",
      verseCount: 3,
      text: [
        { verseNumber: "1", text: "verse-1" },
        { verseNumber: "2", text: "verse-2" },
        { verseNumber: "3", text: "verse-3" },
      ],
    },
  ],
});

test("maps words to the correct verse across line breaks", () => {
  const page = buildSingleSurahPage();
  const pageLines: MushafPageLines = {
    pageNumber: 10,
    lines: [
      {
        lineNumber: 1,
        words: [
          { text: "w1", charType: "word" },
          { text: "w2", charType: "word" },
          { text: "١", charType: "end" },
          { text: "w3", charType: "word" },
        ],
      },
      {
        lineNumber: 2,
        words: [
          { text: "w4", charType: "word" },
          { text: "٢", charType: "end" },
          { text: "w5", charType: "word" },
          { text: "w6", charType: "word" },
          { text: "٣", charType: "end" },
        ],
      },
    ],
  };

  const lines = buildQuoteLineMappings(page, pageLines);

  assert.equal(lines.length, 2);
  assert.equal(lines[0].wordTokens[0].verseNumber, "1");
  assert.equal(lines[0].wordTokens[1].verseNumber, "1");
  assert.equal(lines[0].wordTokens[2].verseNumber, "2");
  assert.equal(lines[1].wordTokens[0].verseNumber, "2");
  assert.equal(lines[1].wordTokens[1].verseNumber, "3");
  assert.equal(lines[1].wordTokens[2].verseNumber, "3");
});

test("maps verse ownership correctly when page contains multiple surahs", () => {
  const page: MushafPage = {
    pageNumber: 50,
    surahs: [
      {
        chapterNumber: 1,
        titleAr: "Al-Fatihah",
        verseCount: 1,
        text: [{ verseNumber: "7", text: "fatiha-7" }],
      },
      {
        chapterNumber: 2,
        titleAr: "Al-Baqarah",
        verseCount: 2,
        text: [
          { verseNumber: "1", text: "baqara-1" },
          { verseNumber: "2", text: "baqara-2" },
        ],
      },
    ],
  };

  const pageLines: MushafPageLines = {
    pageNumber: 50,
    lines: [
      {
        lineNumber: 3,
        words: [
          { text: "a", charType: "word" },
          { text: "٧", charType: "end" },
          { text: "b", charType: "word" },
          { text: "١", charType: "end" },
          { text: "c", charType: "word" },
          { text: "٢", charType: "end" },
        ],
      },
    ],
  };

  const [line] = buildQuoteLineMappings(page, pageLines);
  assert.ok(line);

  assert.equal(line.wordTokens[0].surahId, 1);
  assert.equal(line.wordTokens[0].surahName, "Al-Fatihah");
  assert.equal(line.wordTokens[1].surahId, 2);
  assert.equal(line.wordTokens[1].verseNumber, "1");
  assert.equal(line.wordTokens[2].surahId, 2);
  assert.equal(line.wordTokens[2].verseNumber, "2");
});

test("advances verse cursor on every end marker and clamps at last verse", () => {
  const page = buildSingleSurahPage();
  const pageLines: MushafPageLines = {
    pageNumber: 10,
    lines: [
      {
        lineNumber: 5,
        words: [
          { text: "a", charType: "word" },
          { text: "١", charType: "end" },
          { text: "b", charType: "word" },
          { text: "٢", charType: "end" },
          { text: "c", charType: "word" },
          { text: "٣", charType: "end" },
          { text: "extra", charType: "word" },
          { text: "٤", charType: "end" },
        ],
      },
    ],
  };

  const [line] = buildQuoteLineMappings(page, pageLines);
  const verseNumbers = line.wordTokens.map((token) => token.verseNumber);
  assert.deepEqual(verseNumbers, ["1", "2", "3", "3"]);
});

test("resolves nearest verse from measured token layouts when available", () => {
  const page = buildSingleSurahPage();
  const pageLines: MushafPageLines = {
    pageNumber: 10,
    lines: [
      {
        lineNumber: 7,
        words: [
          { text: "aa", charType: "word" },
          { text: "١", charType: "end" },
          { text: "bb", charType: "word" },
          { text: "٢", charType: "end" },
          { text: "cc", charType: "word" },
          { text: "٣", charType: "end" },
        ],
      },
    ],
  };

  const [line] = buildQuoteLineMappings(page, pageLines);
  const resolved = resolveQuoteFromLinePress({
    line,
    locationX: 150,
    lineWidth: 240,
    pageNumber: 10,
    tokenLayouts: [
      { tokenIndex: 0, x: 10, width: 30 },
      { tokenIndex: 1, x: 110, width: 30 },
      { tokenIndex: 2, x: 205, width: 30 },
    ],
  });

  assert.ok(resolved);
  assert.equal(resolved.verseNumber, "2");
});

test("falls back to char-ratio mapping when measured token layouts are missing", () => {
  const page = buildSingleSurahPage();
  const pageLines: MushafPageLines = {
    pageNumber: 10,
    lines: [
      {
        lineNumber: 9,
        words: [
          { text: "aaa", charType: "word" },
          { text: "١", charType: "end" },
          { text: "bbb", charType: "word" },
          { text: "٢", charType: "end" },
          { text: "ccc", charType: "word" },
          { text: "٣", charType: "end" },
        ],
      },
    ],
  };

  const [line] = buildQuoteLineMappings(page, pageLines);

  const resolvedLeft = resolveQuoteFromLinePress({
    line,
    locationX: 12,
    lineWidth: 300,
    pageNumber: 10,
  });
  const resolvedRight = resolveQuoteFromLinePress({
    line,
    locationX: 290,
    lineWidth: 300,
    pageNumber: 10,
  });

  assert.ok(resolvedLeft);
  assert.ok(resolvedRight);
  assert.equal(resolvedLeft.verseNumber, "1");
  assert.equal(resolvedRight.verseNumber, "3");
});

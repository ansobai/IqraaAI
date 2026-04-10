import assert from "node:assert/strict";
import test from "node:test";

import type { MushafPage, MushafPageLines } from "./mushafData";
import {
  buildPageVerseWordIndexMap,
  resolvePageRecitationWordIndex,
} from "./pageRecitationWordMap";

test("buildPageVerseWordIndexMap maps words across lines to verse keys", () => {
  const page: MushafPage = {
    pageNumber: 10,
    surahs: [
      {
        chapterNumber: 2,
        titleAr: "البقرة",
        verseCount: 3,
        text: [
          { verseNumber: "1", text: "v1" },
          { verseNumber: "2", text: "v2" },
          { verseNumber: "3", text: "v3" },
        ],
      },
    ],
  };

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

  const map = buildPageVerseWordIndexMap(page, pageLines);

  assert.deepEqual(map.get("2:1"), [0, 1]);
  assert.deepEqual(map.get("2:2"), [2, 3]);
  assert.deepEqual(map.get("2:3"), [4, 5]);
});

test("buildPageVerseWordIndexMap keeps ownership correct on multi-surah pages", () => {
  const page: MushafPage = {
    pageNumber: 50,
    surahs: [
      {
        chapterNumber: 1,
        titleAr: "الفاتحة",
        verseCount: 1,
        text: [{ verseNumber: "7", text: "f7" }],
      },
      {
        chapterNumber: 2,
        titleAr: "البقرة",
        verseCount: 2,
        text: [
          { verseNumber: "1", text: "b1" },
          { verseNumber: "2", text: "b2" },
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
          { text: "d", charType: "word" },
          { text: "٢", charType: "end" },
        ],
      },
    ],
  };

  const map = buildPageVerseWordIndexMap(page, pageLines);

  assert.deepEqual(map.get("1:7"), [0]);
  assert.deepEqual(map.get("2:1"), [1]);
  assert.deepEqual(map.get("2:2"), [2, 3]);
});

test("resolvePageRecitationWordIndex returns null for mismatched indexes", () => {
  const page: MushafPage = {
    pageNumber: 2,
    surahs: [
      {
        chapterNumber: 2,
        titleAr: "البقرة",
        verseCount: 2,
        text: [
          { verseNumber: "1", text: "v1" },
          { verseNumber: "2", text: "v2" },
        ],
      },
    ],
  };

  const pageLines: MushafPageLines = {
    pageNumber: 2,
    lines: [
      {
        lineNumber: 1,
        words: [
          { text: "x", charType: "word" },
          { text: "١", charType: "end" },
          { text: "y", charType: "word" },
          { text: "٢", charType: "end" },
        ],
      },
    ],
  };

  const map = buildPageVerseWordIndexMap(page, pageLines);

  assert.equal(
    resolvePageRecitationWordIndex(
      map,
      { surahId: 2, verseNumber: "2" },
      0,
    ),
    1,
  );
  assert.equal(
    resolvePageRecitationWordIndex(
      map,
      { surahId: 2, verseNumber: "2" },
      4,
    ),
    null,
  );
  assert.equal(
    resolvePageRecitationWordIndex(
      map,
      { surahId: 3, verseNumber: "1" },
      0,
    ),
    null,
  );
});

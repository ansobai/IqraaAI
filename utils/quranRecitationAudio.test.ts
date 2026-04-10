import assert from "node:assert/strict";
import test from "node:test";

import type { MushafPage } from "./mushafData";
import {
  buildPageVerseQueue,
  buildVerseAudioCandidates,
  formatVerseAudioKey,
  formatVerseMapKey,
  normalizeTimedWordSegments,
  resolveCurrentWordIndexFromSegments,
} from "./quranRecitationAudio";

test("formatVerseAudioKey pads surah and verse into SSSAAA", () => {
  assert.equal(formatVerseAudioKey(1, 7), "001007");
  assert.equal(formatVerseAudioKey(12, 105), "012105");
  assert.equal(formatVerseAudioKey("114", "6"), "114006");
});

test("buildVerseAudioCandidates returns the fallback order", () => {
  const key = "002255";
  assert.deepEqual(buildVerseAudioCandidates(key), [
    "https://everyayah.com/data/Maher_AlMuaiqly_64kbps/002255.mp3",
    "https://everyayah.com/data/MaherAlMuaiqly128kbps/002255.mp3",
    "https://everyayah.com/data/Alafasy_128kbps/002255.mp3",
  ]);
});

test("buildPageVerseQueue preserves verse order across multi-surah pages", () => {
  const page: MushafPage = {
    pageNumber: 604,
    juzNumber: 30,
    surahs: [
      {
        chapterNumber: 112,
        titleAr: "الإخلاص",
        verseCount: 4,
        text: [
          { verseNumber: "1", text: "v1" },
          { verseNumber: "2", text: "v2" },
        ],
      },
      {
        chapterNumber: 113,
        titleAr: "الفلق",
        verseCount: 5,
        text: [{ verseNumber: "1", text: "v3" }],
      },
      {
        chapterNumber: 114,
        titleAr: "الناس",
        verseCount: 6,
        text: [
          { verseNumber: "1", text: "v4" },
          { verseNumber: "2", text: "v5" },
        ],
      },
    ],
  };

  assert.deepEqual(buildPageVerseQueue(page), [
    { surahId: 112, verseNumber: "1" },
    { surahId: 112, verseNumber: "2" },
    { surahId: 113, verseNumber: "1" },
    { surahId: 114, verseNumber: "1" },
    { surahId: 114, verseNumber: "2" },
  ]);
});

test("formatVerseMapKey normalizes surah and verse values", () => {
  assert.equal(formatVerseMapKey(3, 10), "3:10");
  assert.equal(formatVerseMapKey("003", "010"), "3:10");
  assert.equal(formatVerseMapKey("bad", "0"), "1:1");
});

test("normalizeTimedWordSegments sorts and merges duplicate word segments", () => {
  const normalized = normalizeTimedWordSegments([
    [0, 2, 300, 450],
    [0, 1, 100, 200],
    [9, 2, 250, 500],
    [1, 3, 501, 700],
    ["x", 4, 800, 900],
  ]);

  assert.deepEqual(normalized, [
    { wordIndex: 0, startMs: 100, endMs: 200 },
    { wordIndex: 1, startMs: 250, endMs: 500 },
    { wordIndex: 2, startMs: 501, endMs: 700 },
    { wordIndex: 3, startMs: 800, endMs: 900 },
  ]);
});

test("resolveCurrentWordIndexFromSegments handles boundary positions", () => {
  const segments = [
    { wordIndex: 0, startMs: 100, endMs: 200 },
    { wordIndex: 1, startMs: 300, endMs: 400 },
    { wordIndex: 2, startMs: 450, endMs: 550 },
  ];

  assert.equal(resolveCurrentWordIndexFromSegments([], 120), null);
  assert.equal(resolveCurrentWordIndexFromSegments(segments, 0), 0);
  assert.equal(resolveCurrentWordIndexFromSegments(segments, 150), 0);
  assert.equal(resolveCurrentWordIndexFromSegments(segments, 250), 0);
  assert.equal(resolveCurrentWordIndexFromSegments(segments, 300), 1);
  assert.equal(resolveCurrentWordIndexFromSegments(segments, 430), 1);
  assert.equal(resolveCurrentWordIndexFromSegments(segments, 551), 2);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { MushafPage } from "./mushafData";
import {
  buildPageVerseQueue,
  buildVerseAudioCandidates,
  formatVerseAudioKey,
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

import type { MushafPage } from "./mushafData";

export type QuranRecitationVerse = {
  surahId: number;
  verseNumber: string;
};

const MAHER_64_BASE = "https://everyayah.com/data/Maher_AlMuaiqly_64kbps";
const MAHER_128_BASE = "https://everyayah.com/data/MaherAlMuaiqly128kbps";
const ALAFASY_128_BASE = "https://everyayah.com/data/Alafasy_128kbps";

const normalizePositiveInteger = (value: number | string) => {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.trunc(parsed);
};

export const formatVerseAudioKey = (
  surahId: number | string,
  verseNumber: number | string,
) => {
  const safeSurah = String(normalizePositiveInteger(surahId)).padStart(3, "0");
  const safeVerse = String(normalizePositiveInteger(verseNumber)).padStart(3, "0");
  return `${safeSurah}${safeVerse}`;
};

export const buildVerseAudioCandidates = (audioKey: string) => [
  `${MAHER_64_BASE}/${audioKey}.mp3`,
  `${MAHER_128_BASE}/${audioKey}.mp3`,
  `${ALAFASY_128_BASE}/${audioKey}.mp3`,
];

export const buildPageVerseQueue = (page: MushafPage): QuranRecitationVerse[] =>
  page.surahs.flatMap((surah) => {
    const surahId = normalizePositiveInteger(surah.chapterNumber);
    return surah.text.map((verse) => ({
      surahId,
      verseNumber: String(normalizePositiveInteger(verse.verseNumber ?? "1")),
    }));
  });

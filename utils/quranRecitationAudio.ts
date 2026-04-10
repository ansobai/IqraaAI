import type { MushafPage } from "./mushafData";

export type QuranRecitationVerse = {
  surahId: number;
  verseNumber: string;
};

export type QuranRecitationWordSyncSource = "timed" | "fallback";

export type QuranTimedWordSegment = {
  wordIndex: number;
  startMs: number;
  endMs: number;
};

export type QuranTimedRecitationVerseAudio = {
  audioUrl: string;
  segments: QuranTimedWordSegment[];
};

const MAHER_64_BASE = "https://everyayah.com/data/Maher_AlMuaiqly_64kbps";
const MAHER_128_BASE = "https://everyayah.com/data/MaherAlMuaiqly128kbps";
const ALAFASY_128_BASE = "https://everyayah.com/data/Alafasy_128kbps";
const TIMED_RECITATION_API_BASE = "https://api.quran.com/api/v4";
const TIMED_RECITATION_AUDIO_BASE = "https://verses.quran.com";
const TIMED_RECITATION_ID = 7;
const TIMED_RECITATION_REQUEST_TIMEOUT_MS = 12000;

const TIMED_VERSE_CACHE = new Map<string, QuranTimedRecitationVerseAudio>();
const TIMED_VERSE_IN_FLIGHT = new Map<
  string,
  Promise<QuranTimedRecitationVerseAudio | null>
>();

type TimedRecitationAudioFile = {
  url?: unknown;
  segments?: unknown;
};

type TimedRecitationResponse = {
  audio_files?: TimedRecitationAudioFile[];
};

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

export const formatVerseMapKey = (
  surahId: number | string,
  verseNumber: number | string,
) => `${normalizePositiveInteger(surahId)}:${normalizePositiveInteger(verseNumber)}`;

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

const normalizeTimedAudioUrl = (rawUrl: string) => {
  if (!rawUrl) return null;
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("//")) return `https:${rawUrl}`;
  const clean = rawUrl.replace(/^\/+/, "");
  return `${TIMED_RECITATION_AUDIO_BASE}/${clean}`;
};

export const normalizeTimedWordSegments = (
  rawSegments: unknown,
): QuranTimedWordSegment[] => {
  if (!Array.isArray(rawSegments)) return [];

  const mergedByWordIndex = new Map<number, QuranTimedWordSegment>();

  for (const segment of rawSegments) {
    if (!Array.isArray(segment) || segment.length < 4) continue;

    const rawWordPosition = Number(segment[1]);
    const rawStart = Number(segment[2]);
    const rawEnd = Number(segment[3]);

    if (
      !Number.isFinite(rawWordPosition) ||
      !Number.isFinite(rawStart) ||
      !Number.isFinite(rawEnd)
    ) {
      continue;
    }

    const wordIndex = Math.max(0, Math.trunc(rawWordPosition) - 1);
    const startMs = Math.max(0, Math.trunc(rawStart));
    const endMs = Math.max(startMs, Math.trunc(rawEnd));

    const existing = mergedByWordIndex.get(wordIndex);
    if (existing) {
      mergedByWordIndex.set(wordIndex, {
        wordIndex,
        startMs: Math.min(existing.startMs, startMs),
        endMs: Math.max(existing.endMs, endMs),
      });
      continue;
    }

    mergedByWordIndex.set(wordIndex, { wordIndex, startMs, endMs });
  }

  return Array.from(mergedByWordIndex.values()).sort(
    (left, right) => left.startMs - right.startMs || left.wordIndex - right.wordIndex,
  );
};

export const resolveCurrentWordIndexFromSegments = (
  segments: QuranTimedWordSegment[],
  positionMillis: number,
): number | null => {
  if (!segments.length) return null;

  const safePosition = Number.isFinite(positionMillis)
    ? Math.max(0, Math.trunc(positionMillis))
    : 0;

  let previousWordIndex = segments[0].wordIndex;

  for (const segment of segments) {
    if (safePosition < segment.startMs) {
      return previousWordIndex;
    }

    if (safePosition <= segment.endMs) {
      return segment.wordIndex;
    }

    previousWordIndex = segment.wordIndex;
  }

  return previousWordIndex;
};

const fetchTimedVerseRecitationAudioInternal = async (
  verse: QuranRecitationVerse,
): Promise<QuranTimedRecitationVerseAudio | null> => {
  const verseKey = formatVerseMapKey(verse.surahId, verse.verseNumber);
  const requestUrl =
    `${TIMED_RECITATION_API_BASE}/recitations/${TIMED_RECITATION_ID}/by_ayah/` +
    `${verseKey}?fields=segments`;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    TIMED_RECITATION_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(requestUrl, { signal: timeoutController.signal });
    if (!response.ok) return null;

    const payload = (await response.json()) as TimedRecitationResponse;
    const firstAudioFile = payload.audio_files?.[0];
    if (!firstAudioFile) return null;
    if (typeof firstAudioFile.url !== "string" || !firstAudioFile.url.trim()) {
      return null;
    }

    const audioUrl = normalizeTimedAudioUrl(firstAudioFile.url.trim());
    if (!audioUrl) return null;

    return {
      audioUrl,
      segments: normalizeTimedWordSegments(firstAudioFile.segments),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const fetchTimedVerseRecitationAudio = async (
  verse: QuranRecitationVerse,
): Promise<QuranTimedRecitationVerseAudio | null> => {
  const verseKey = formatVerseMapKey(verse.surahId, verse.verseNumber);
  const cached = TIMED_VERSE_CACHE.get(verseKey);
  if (cached) return cached;

  const inFlight = TIMED_VERSE_IN_FLIGHT.get(verseKey);
  if (inFlight) return inFlight;

  const requestPromise = fetchTimedVerseRecitationAudioInternal(verse).then(
    (result) => {
      TIMED_VERSE_IN_FLIGHT.delete(verseKey);
      if (result) {
        TIMED_VERSE_CACHE.set(verseKey, result);
      }
      return result;
    },
  );

  TIMED_VERSE_IN_FLIGHT.set(verseKey, requestPromise);
  return requestPromise;
};

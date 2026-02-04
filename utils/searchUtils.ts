import { ARABIC_SURAHS } from "../constants/surahNames";
import { MUSHAF_PAGES } from "./mushafData";

export interface SurahMatch {
  type: "surah";
  id: number;
  name: string;
}

export interface VerseMatch {
  type: "verse";
  surahId: number;
  surahName: string;
  verseNumber: string;
  text: string;
  pageNumber: number;
}

export type SearchResult = SurahMatch | VerseMatch;

// Basic normalization: remove tashkeel, normalize alefs
export const normalizeText = (text: string): string => {
  if (!text) return "";

  let normalized = text;

  // Remove Tashkeel
  normalized = normalized.replace(/[\u064B-\u065F\u0670]/g, "");

  // Normalize Alefs
  normalized = normalized.replace(/[أإآٱ]/g, "ا");

  // Normalize Taa Marbuta to Ha (optional, but helps with search)
  // normalized = normalized.replace(/ة/g, "ه");

  // Normalize Ya to Alif Maqsura (optional)
  // normalized = normalized.replace(/ي/g, "ى");

  return normalized;
};

export const searchSurahs = (query: string): SurahMatch[] => {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  const matches: SurahMatch[] = [];

  ARABIC_SURAHS.forEach((name, index) => {
    if (index === 0) return; // Skip empty first element
    const normalizedName = normalizeText(name);
    if (normalizedName.includes(normalizedQuery)) {
      matches.push({
        type: "surah",
        id: index,
        name: name,
      });
    }
  });

  return matches;
};

export const searchVerses = (query: string): VerseMatch[] => {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery || normalizedQuery.length < 3) return []; // Minimum 3 chars for verse search to avoid too many results

  const matches: VerseMatch[] = [];

  // Iterate through all pages
  for (const page of MUSHAF_PAGES) {
    if (!page) continue;

    for (const surah of page.surahs) {
      for (const verse of surah.text) {
        const normalizedVerseText = normalizeText(verse.text);
        if (normalizedVerseText.includes(normalizedQuery)) {
          matches.push({
            type: "verse",
            surahId: surah.chapterNumber,
            surahName: surah.titleAr,
            verseNumber: verse.verseNumber,
            text: verse.text,
            pageNumber: page.pageNumber,
          });

          // Limit results for performance
          if (matches.length >= 50) return matches;
        }
      }
    }
  }

  return matches;
};

export const searchQuran = (query: string): SearchResult[] => {
  const surahMatches = searchSurahs(query);
  const verseMatches = searchVerses(query);

  return [...surahMatches, ...verseMatches];
};

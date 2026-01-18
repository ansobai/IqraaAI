import { Asset } from "expo-asset";
import mushaf from "../assets/data/madani-muhsaf.json";
import { PAGE_ASSET_MODULES } from "../assets/data/mushaf-lines/pages-manifest";

export interface MushafLineWord {
  text: string;
  charType: string;
}

export interface MushafPageMeta {
  pageNumber: number;
  juzNumber?: number;
}

export interface MushafSurahVerse {
  verseNumber: string;
  text: string;
}

export interface MushafSurah {
  chapterNumber: number;
  titleEn?: string;
  titleAr: string;
  verseCount: number;
  text: MushafSurahVerse[];
}

export interface MushafPage extends MushafPageMeta {
  surahs: MushafSurah[];
}

export interface MushafPageLines extends MushafPageMeta {
  lines: {
    lineNumber: number;
    words: MushafLineWord[];
  }[];
}

const rawPages = mushaf as Array<Record<string, any>>;

export const MUSHAF_PAGES: MushafPage[] = rawPages
  .map((page, index) => {
    if (!page || index === 0) return null;
    const surahKeys = Object.keys(page)
      .filter((key) => key !== "juzNumber")
      .sort((a, b) => Number(a) - Number(b));
    const surahs = surahKeys
      .map((key) => page[key])
      .filter(Boolean) as MushafSurah[];

    return {
      pageNumber: index,
      juzNumber: page.juzNumber,
      surahs,
    };
  })
  .filter((page): page is MushafPage => Boolean(page));

export const MUSHAF_SURAH_START_PAGE: Record<string, number> = (() => {
  const map: Record<string, number> = {};

  rawPages.forEach((page, index) => {
    if (!page || index === 0) return;
    const surahKeys = Object.keys(page).filter((key) => key !== "juzNumber");
    for (const surahKey of surahKeys) {
      const surah = page[surahKey];
      const firstVerse = surah?.text?.[0];
      if (firstVerse?.verseNumber === "1" && !map[surah.chapterNumber]) {
        map[surah.chapterNumber] = index;
      }
    }
  });

  return map;
})();

export const getSurahIdForPageNumber = (pageNumber: number) => {
  if (!Number.isFinite(pageNumber) || pageNumber <= 0) return 1;

  const entries = Object.entries(MUSHAF_SURAH_START_PAGE)
    .map(([id, page]) => ({ id: Number(id), page }))
    .filter((entry) => Number.isFinite(entry.page))
    .sort((a, b) => a.page - b.page);

  let match = 1;
  for (const entry of entries) {
    if (entry.page <= pageNumber) {
      match = entry.id;
    } else {
      break;
    }
  }

  return match;
};

const PAGE_CACHE = new Map<number, MushafPageLines>();

/**
 * Load mushaf page data by fetching directly from expo-asset.
 * Works in both Expo Go (HTTP URL) and production builds (file:// URI).
 */
export const loadMushafPage = async (
  pageNumber: number
): Promise<MushafPageLines | null> => {
  // Skip invalid page numbers (pages are 1-604)
  if (pageNumber < 1 || pageNumber > 604) {
    return null;
  }

  // Check cache first
  if (PAGE_CACHE.has(pageNumber)) {
    return PAGE_CACHE.get(pageNumber) ?? null;
  }

  const moduleId = PAGE_ASSET_MODULES[pageNumber];
  if (!moduleId) {
    console.warn(`No asset module for page ${pageNumber}`);
    return null;
  }

  try {
    const asset = Asset.fromModule(moduleId);
    await asset.downloadAsync();

    if (!asset.localUri) {
      console.warn(`Asset localUri is null for page ${pageNumber}`);
      return null;
    }

    // Fetch content directly from localUri (works for both http:// and file://)
    const response = await fetch(asset.localUri);
    const text = await response.text();
    const parsed = JSON.parse(text) as MushafPageLines;

    PAGE_CACHE.set(pageNumber, parsed);
    return parsed;
  } catch (error) {
    console.error(`Failed to load page ${pageNumber}:`, error);
    return null;
  }
};

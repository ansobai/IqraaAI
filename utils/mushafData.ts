import mushaf from "../assets/data/madani-muhsaf.json";

export interface MushafVerse {
  verseNumber: string;
  text: string;
}

export interface MushafSurahPage {
  chapterNumber: number;
  titleEn: string;
  titleAr: string;
  verseCount: number;
  text: MushafVerse[];
}

export interface MushafPage {
  pageNumber: number;
  juzNumber?: number;
  surahs: MushafSurahPage[];
}

const rawPages = mushaf as Array<Record<string, any>>;

const toSurahPage = (raw: any): MushafSurahPage => ({
  chapterNumber: Number(raw.chapterNumber),
  titleEn: raw.titleEn ?? "",
  titleAr: raw.titleAr ?? "",
  verseCount: Number(raw.verseCount ?? 0),
  text: Array.isArray(raw.text) ? raw.text : [],
});

export const MUSHAF_PAGES: MushafPage[] = rawPages
  .map((page, index) => {
    if (!page || index === 0) return null;

    const surahKeys = Object.keys(page).filter((key) => key !== "juzNumber");
    if (surahKeys.length === 0) return null;

    const surahs = surahKeys
      .map((key) => toSurahPage(page[key]))
      .sort((a, b) => a.chapterNumber - b.chapterNumber);

    return {
      pageNumber: index,
      juzNumber: page.juzNumber,
      surahs,
    };
  })
  .filter((page): page is MushafPage => Boolean(page));

export const MUSHAF_SURAH_START_PAGE: Record<string, number> = (() => {
  const map: Record<string, number> = {};

  for (const page of MUSHAF_PAGES) {
    for (const surah of page.surahs) {
      const firstVerse = surah.text?.[0];
      if (firstVerse?.verseNumber === "1" && !map[surah.chapterNumber]) {
        map[surah.chapterNumber] = page.pageNumber;
      }
    }
  }

  return map;
})();

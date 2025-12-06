// utils/quranProcessor.ts
import quranReady from "@/assets/data/quran-ready.json";

// Types for the ready data
export interface ReadyVerse {
  text: string;
  ayah: number;
  surah: string;
  isStart: boolean;
  isFatihaOrTawbah: boolean;
}

export interface ReadyPage {
  pageNumber: number;
  verses: ReadyVerse[];
}

// Export the pre-calculated data directly
export const ALL_PAGES = quranReady.pages as ReadyPage[];
export const SURAH_START_PAGE = quranReady.surahMap as {
  [key: string]: number;
};

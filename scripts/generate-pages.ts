// scripts/generate-pages.ts (or generate-pages.ts at project root)
import fs from "fs";
import path from "path";

// 1. Shape of raw quran.json
interface RawVerse {
  ayahid: number;
  Ayah_number: number;
  pageid: number;
  "sura name": string; // e.g. "Al-Fatiha--الفاتحة"
  chapter_number: number; // 1..114
  content_ar: string;
}

// 2. Optimized shapes for the app
interface OptimizedVerse {
  text: string; // Arabic content
  ayah: number; // ayah number within surah
  surah: string; // Arabic surah name only, e.g. "الفاتحة"
  isStart: boolean; // whether this is ayah 1 (start of surah)
  isFatihaOrTawbah: boolean;
}

interface OptimizedPage {
  pageNumber: number; // mushaf page number
  verses: OptimizedVerse[];
}

// 3. Load raw data
const rawDataPath = path.join(process.cwd(), "assets/data/quran.json");
const rawJson = fs.readFileSync(rawDataPath, "utf-8");
const rawData: RawVerse[] = JSON.parse(rawJson);

console.log(`🔹 Processing ${rawData.length} verses...`);

// 4. Helpers / maps we build
const pagesMap: { [pageNumber: number]: OptimizedVerse[] } = {};
const surahStartPage: { [chapter: number]: number } = {};
const surahNames: { [chapter: number]: string } = {}; // <-- chapter → Arabic name

// 5. Iterate all verses and build structures
rawData.forEach((verse) => {
  const pageNum = verse.pageid;

  // Ensure page bucket exists
  if (!pagesMap[pageNum]) {
    pagesMap[pageNum] = [];
  }

  // Record first page of surah (where ayah 1 appears)
  if (verse.Ayah_number === 1) {
    surahStartPage[verse.chapter_number] = pageNum;
  }

  // "sura name" looks like: "Al-Fatiha--الفاتحة" or sometimes just one part
  const surahNameParts = verse["sura name"].split("--");
  const arabicSurahName =
    surahNameParts.length > 1 ? surahNameParts[1] : surahNameParts[0];

  // Store Arabic name once per chapter
  if (!surahNames[verse.chapter_number]) {
    surahNames[verse.chapter_number] = arabicSurahName.trim();
  }

  const cleanVerse: OptimizedVerse = {
    text: verse.content_ar,
    ayah: verse.Ayah_number,
    surah: arabicSurahName.trim(), // Arabic-only name
    isStart: verse.Ayah_number === 1,
    isFatihaOrTawbah: verse.chapter_number === 1 || verse.chapter_number === 9,
  };

  pagesMap[pageNum].push(cleanVerse);
});

// 6. Convert pagesMap to a sorted array of pages
const sortedPages: OptimizedPage[] = [];

for (let i = 1; i <= 604; i++) {
  if (pagesMap[i]) {
    sortedPages.push({
      pageNumber: i,
      verses: pagesMap[i],
    });
  }
}

console.log(`📄 Built ${sortedPages.length} pages.`);
console.log(
  `Detected ${Object.keys(surahNames).length} surahs with Arabic names.`
);

// 7. Final output structure
const finalData = {
  generatedAt: new Date().toISOString(),
  surahMap: surahStartPage, // chapter_number → first page
  surahNames, // chapter_number → Arabic name
  pages: sortedPages, // all pages with verses
};

// 8. Save to quran-ready.json
const outputPath = path.join(process.cwd(), "assets/data/quran-ready.json");
fs.writeFileSync(outputPath, JSON.stringify(finalData, null, 2), "utf-8");

console.log(`Success! Written to ${outputPath}`);

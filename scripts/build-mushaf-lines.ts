import fs from "fs";
import path from "path";

type ApiWord = {
  text_uthmani?: string;
  line_number?: number;
  page_number?: number;
  position?: number;
  char_type_name?: string;
};

type ApiVerse = {
  verse_key: string; // "2:1"
  juz_number?: number;
  words?: ApiWord[];
};

type ApiResponse = {
  verses?: ApiVerse[];
};

type LineWord = {
  text: string;
  charType: string;
};

type Line = {
  lineNumber: number;
  words: LineWord[];
};

type Page = {
  pageNumber: number;
  juzNumber?: number;
  lines: Line[];
};

const API_BASE = "https://api.quran.com/api/v4/verses/by_page";
const TOTAL_PAGES = 604;
const REQUEST_DELAY_MS = 60;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const fetchPage = async (pageNumber: number): Promise<ApiResponse> => {
  const url = `${API_BASE}/${pageNumber}?words=true&word_fields=text_uthmani,line_number,page_number,position,char_type_name,verse_key&fields=juz_number`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch page ${pageNumber}: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
};

const extractSurahId = (verseKey: string) => verseKey.split(":")[0] ?? "";
const extractAyah = (verseKey: string) => verseKey.split(":")[1] ?? "";

const build = async () => {
  const pagesDir = path.join(
    process.cwd(),
    "assets/data/mushaf-lines/pages"
  );
  fs.mkdirSync(pagesDir, { recursive: true });

  const pageNumbers: number[] = [];
  const surahStartPage: Record<string, number> = {};
  const manifestLines: string[] = [];

  for (let pageNumber = 1; pageNumber <= TOTAL_PAGES; pageNumber += 1) {
    // Basic pacing to avoid rate limits
    if (pageNumber > 1) {
      await sleep(REQUEST_DELAY_MS);
    }

    const data = await fetchPage(pageNumber);
    const verses = data.verses ?? [];

    const linesMap = new Map<number, Line>();
    let juzNumber: number | undefined;

    verses.forEach((verse) => {
      if (!juzNumber && verse.juz_number) {
        juzNumber = verse.juz_number;
      }

      const surahId = extractSurahId(verse.verse_key);
      const ayahNumber = extractAyah(verse.verse_key);
      if (ayahNumber === "1" && surahId && !surahStartPage[surahId]) {
        surahStartPage[surahId] = pageNumber;
      }

      const words = verse.words ?? [];
      words.forEach((word) => {
        const lineNumber = word.line_number;
        if (!lineNumber) return;

        if (!linesMap.has(lineNumber)) {
          linesMap.set(lineNumber, { lineNumber, words: [] });
        }

        const line = linesMap.get(lineNumber);
        if (!line) return;

        line.words.push({
          text: word.text_uthmani ?? "",
          charType: word.char_type_name ?? "word",
        });
      });
    });

    const lines = Array.from(linesMap.values()).sort(
      (a, b) => a.lineNumber - b.lineNumber
    );

    const pageData: Page = {
      pageNumber,
      juzNumber,
      lines,
    };

    const outputPath = path.join(
      pagesDir,
      `page-${String(pageNumber).padStart(3, "0")}.txt`
    );
    fs.writeFileSync(outputPath, JSON.stringify(pageData), "utf-8");
    pageNumbers.push(pageNumber);
    manifestLines.push(
      `  ${pageNumber}: require("./pages/page-${String(pageNumber).padStart(
        3,
        "0"
      )}.txt"),`
    );

    if (pageNumber % 20 === 0) {
      console.log(`Processed page ${pageNumber}/${TOTAL_PAGES}`);
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    surahStartPage,
    pages: pageNumbers,
  };

  const outputPath = path.join(
    process.cwd(),
    "assets/data/mushaf-lines/index.json"
  );
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`Saved mushaf lines index to ${outputPath}`);

  const manifestPath = path.join(
    process.cwd(),
    "assets/data/mushaf-lines/pages-manifest.ts"
  );
  const manifest = `/* eslint-disable */\nexport const PAGE_ASSET_MODULES: Record<number, number> = {\n${manifestLines.join(
    "\n"
  )}\n};\n`;
  fs.writeFileSync(manifestPath, manifest, "utf-8");
  console.log(`Saved page asset manifest to ${manifestPath}`);
};

build().catch((error) => {
  console.error(error);
  process.exit(1);
});

import fs from "fs";
import path from "path";

type SvgEntry = {
  pageNumber: number;
  fileName: string;
};

const SVG_DIR = path.join(process.cwd(), "assets/quran-svgs");
const OUTPUT_PATH = path.join(SVG_DIR, "pages-manifest.ts");

const isSvgFile = (fileName: string) => fileName.toLowerCase().endsWith(".svg");

const toEntry = (fileName: string): SvgEntry | null => {
  const match = fileName.match(/(\d+)\.svg$/);
  if (!match) return null;

  const pageNumber = Number(match[1]);
  if (!Number.isFinite(pageNumber)) return null;

  return { pageNumber, fileName };
};

const files = fs.readdirSync(SVG_DIR).filter(isSvgFile);
const entries = files
  .map(toEntry)
  .filter((entry): entry is SvgEntry => Boolean(entry))
  .sort((a, b) => a.pageNumber - b.pageNumber);

const manifestLines = entries.map(
  (entry) => `  ${entry.pageNumber}: require("./${entry.fileName}"),`
);

const output = `/* eslint-disable */
export const QURAN_SVG_ASSET_MODULES: Record<number, number> = {
${manifestLines.join("\n")}
};
`;

fs.writeFileSync(OUTPUT_PATH, output, "utf-8");
console.log(`Saved SVG manifest to ${OUTPUT_PATH} (${entries.length} entries).`);

type ClipRect = {
  clipPathId?: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

export type QuranTextBox = {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  clipPathId?: string;
  isFallback: boolean;
};

const INTERNAL_WIDTH = 382.677;
const INTERNAL_HEIGHT = 547.086;
const FULL_PAGE_AREA_THRESHOLD = 0.95;
const MIN_TEXT_BOX_X_RATIO = 0.07;
const MAX_TEXT_BOX_X_RATIO = 0.32;
const MIN_TEXT_BOX_Y_RATIO = 0.1;
const MAX_TEXT_BOX_Y_RATIO = 0.27;
const MIN_TEXT_BOX_WIDTH_RATIO = 0.5;
const MAX_TEXT_BOX_WIDTH_RATIO = 0.75;
const MIN_TEXT_BOX_HEIGHT_RATIO = 0.5;
const MAX_TEXT_BOX_HEIGHT_RATIO = 0.82;
const ODD_PAGE_FALLBACK_TEXT_BOX: Omit<QuranTextBox, "isFallback"> = {
  xRatio: 0.121,
  yRatio: 0.137,
  widthRatio: 0.636,
  heightRatio: 0.729,
};
const EVEN_PAGE_FALLBACK_TEXT_BOX: Omit<QuranTextBox, "isFallback"> = {
  xRatio: 0.241,
  yRatio: 0.137,
  widthRatio: 0.631,
  heightRatio: 0.724,
};
const GENERIC_FALLBACK_TEXT_BOX: Omit<QuranTextBox, "isFallback"> = {
  xRatio: 0.18,
  yRatio: 0.137,
  widthRatio: 0.634,
  heightRatio: 0.727,
};

const NUMBER_PATTERN = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";
const RECT_SEGMENT_REGEX = new RegExp(
  `M\\s*(${NUMBER_PATTERN})\\s*[ ,]\\s*(${NUMBER_PATTERN})\\s*([Hh])\\s*(${NUMBER_PATTERN})\\s*([Vv])\\s*(${NUMBER_PATTERN})\\s*([Hh])\\s*(${NUMBER_PATTERN})\\s*[Zz]`,
  "g",
);
const CLIP_PATH_REGEX =
  /<clipPath id="([^"]+)"[^>]*>\s*<path[^>]*\sd="([^"]+)"[^>]*\/?>\s*<\/clipPath>/g;
const SVG_PATH_REGEX = /<path[^>]*\sd="([^"]+)"[^>]*\/?>/g;

const BOX_CACHE = new Map<number, QuranTextBox>();
type QuranSvgRegistryModule = {
  getCachedQuranPageSvgXml: (pageNumber: number) => string | null;
  loadQuranPageSvgXml: (pageNumber: number) => Promise<string | null>;
};

let quranSvgRegistryModulePromise: Promise<QuranSvgRegistryModule> | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const toFiniteNumber = (rawValue: string) => {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildClipRect = (
  clipPathId: string | undefined,
  xLeft: number,
  xRight: number,
  yTop: number,
  yBottom: number,
): ClipRect | null => {
  if (
    !Number.isFinite(xLeft) ||
    !Number.isFinite(xRight) ||
    !Number.isFinite(yTop) ||
    !Number.isFinite(yBottom)
  ) {
    return null;
  }

  const xMin = Math.min(xLeft, xRight);
  const xMax = Math.max(xLeft, xRight);
  const yMin = Math.min(yBottom, yTop);
  const yMax = Math.max(yBottom, yTop);

  if (xMax <= xMin || yMax <= yMin) return null;

  return {
    clipPathId,
    xMin,
    yMin,
    xMax,
    yMax,
  };
};

const rectArea = (rect: ClipRect) =>
  (rect.xMax - rect.xMin) * (rect.yMax - rect.yMin);

const isFullPageRect = (rect: ClipRect) => {
  const areaRatio = rectArea(rect) / (INTERNAL_WIDTH * INTERNAL_HEIGHT);
  return areaRatio >= FULL_PAGE_AREA_THRESHOLD;
};

const isLikelyTextBoxRect = (rect: ClipRect) => {
  const width = rect.xMax - rect.xMin;
  const height = rect.yMax - rect.yMin;
  const xRatio = rect.xMin / INTERNAL_WIDTH;
  const yRatio = (INTERNAL_HEIGHT - rect.yMax) / INTERNAL_HEIGHT;
  const widthRatio = width / INTERNAL_WIDTH;
  const heightRatio = height / INTERNAL_HEIGHT;

  return (
    xRatio >= MIN_TEXT_BOX_X_RATIO &&
    xRatio <= MAX_TEXT_BOX_X_RATIO &&
    yRatio >= MIN_TEXT_BOX_Y_RATIO &&
    yRatio <= MAX_TEXT_BOX_Y_RATIO &&
    widthRatio >= MIN_TEXT_BOX_WIDTH_RATIO &&
    widthRatio <= MAX_TEXT_BOX_WIDTH_RATIO &&
    heightRatio >= MIN_TEXT_BOX_HEIGHT_RATIO &&
    heightRatio <= MAX_TEXT_BOX_HEIGHT_RATIO
  );
};

const parseRectSegmentsFromPathData = (
  pathData: string,
  clipPathId?: string,
) => {
  const rects: ClipRect[] = [];
  if (!pathData) return rects;

  RECT_SEGMENT_REGEX.lastIndex = 0;
  for (const match of pathData.matchAll(RECT_SEGMENT_REGEX)) {
    const startX = toFiniteNumber(match[1]);
    const startY = toFiniteNumber(match[2]);
    const firstHorizontalCommand = match[3];
    const firstHorizontalValue = toFiniteNumber(match[4]);
    const verticalCommand = match[5];
    const verticalValue = toFiniteNumber(match[6]);
    const secondHorizontalCommand = match[7];
    const secondHorizontalValue = toFiniteNumber(match[8]);

    if (
      startX == null ||
      startY == null ||
      firstHorizontalValue == null ||
      verticalValue == null ||
      secondHorizontalValue == null
    ) {
      continue;
    }

    const firstHorizontalX = firstHorizontalCommand === "h"
      ? startX + firstHorizontalValue
      : firstHorizontalValue;
    const verticalY = verticalCommand === "v"
      ? startY + verticalValue
      : verticalValue;
    const secondHorizontalX = secondHorizontalCommand === "h"
      ? firstHorizontalX + secondHorizontalValue
      : secondHorizontalValue;

    const rect = buildClipRect(
      clipPathId,
      firstHorizontalX,
      secondHorizontalX,
      startY,
      verticalY,
    );
    if (rect) {
      rects.push(rect);
    }
  }

  return rects;
};

const pickBestTextRect = (rects: ClipRect[]): ClipRect | null => {
  let bestRect: ClipRect | null = null;
  let bestArea = 0;

  for (const rect of rects) {
    if (isFullPageRect(rect)) continue;
    if (!isLikelyTextBoxRect(rect)) continue;

    const area = rectArea(rect);
    if (area <= bestArea) continue;

    bestArea = area;
    bestRect = rect;
  }

  return bestRect;
};

const normalizeRectToBox = (rect: ClipRect): QuranTextBox => {
  const width = rect.xMax - rect.xMin;
  const height = rect.yMax - rect.yMin;

  const xRatio = clamp(rect.xMin / INTERNAL_WIDTH, 0, 1);
  const yRatio = clamp((INTERNAL_HEIGHT - rect.yMax) / INTERNAL_HEIGHT, 0, 1);
  const widthRatio = clamp(width / INTERNAL_WIDTH, 0, 1 - xRatio);
  const heightRatio = clamp(height / INTERNAL_HEIGHT, 0, 1 - yRatio);

  return {
    xRatio,
    yRatio,
    widthRatio,
    heightRatio,
    clipPathId: rect.clipPathId,
    isFallback: false,
  };
};

export const getFallbackQuranTextBox = (pageNumber?: number): QuranTextBox => {
  let fallback = GENERIC_FALLBACK_TEXT_BOX;
  if (Number.isFinite(pageNumber) && pageNumber != null && pageNumber > 0) {
    fallback = pageNumber % 2 === 0
      ? EVEN_PAGE_FALLBACK_TEXT_BOX
      : ODD_PAGE_FALLBACK_TEXT_BOX;
  }

  return {
    ...fallback,
    isFallback: true,
  };
};

export const parseQuranTextBoxFromSvgXml = (
  svgXml: string,
): QuranTextBox | null => {
  if (!svgXml) return null;

  CLIP_PATH_REGEX.lastIndex = 0;
  const clipPathRects: ClipRect[] = [];
  for (const match of svgXml.matchAll(CLIP_PATH_REGEX)) {
    const clipPathId = match[1];
    const pathData = match[2];
    if (!clipPathId || !pathData) continue;
    clipPathRects.push(...parseRectSegmentsFromPathData(pathData, clipPathId));
  }

  const clipPathBestRect = pickBestTextRect(clipPathRects);
  if (clipPathBestRect) {
    return normalizeRectToBox(clipPathBestRect);
  }

  SVG_PATH_REGEX.lastIndex = 0;
  const svgPathRects: ClipRect[] = [];
  for (const match of svgXml.matchAll(SVG_PATH_REGEX)) {
    const pathData = match[1];
    if (!pathData) continue;
    svgPathRects.push(...parseRectSegmentsFromPathData(pathData));
  }

  const svgPathBestRect = pickBestTextRect(svgPathRects);
  if (!svgPathBestRect) return null;
  return normalizeRectToBox(svgPathBestRect);
};

export const resolveQuranTextBox = async (
  pageNumber: number,
): Promise<QuranTextBox> => {
  if (!Number.isFinite(pageNumber) || pageNumber < 1) {
    return getFallbackQuranTextBox(pageNumber);
  }

  const cached = BOX_CACHE.get(pageNumber);
  if (cached) return cached;

  if (!quranSvgRegistryModulePromise) {
    quranSvgRegistryModulePromise = import("./quranSvgRegistry");
  }
  const quranSvgRegistry = await quranSvgRegistryModulePromise;

  const cachedXml = quranSvgRegistry.getCachedQuranPageSvgXml(pageNumber);
  if (cachedXml) {
    const parsed = parseQuranTextBoxFromSvgXml(cachedXml);
    if (parsed) {
      BOX_CACHE.set(pageNumber, parsed);
      return parsed;
    }
  }

  const loadedXml = await quranSvgRegistry.loadQuranPageSvgXml(pageNumber);
  const parsed = loadedXml ? parseQuranTextBoxFromSvgXml(loadedXml) : null;
  const resolved = parsed ?? getFallbackQuranTextBox(pageNumber);
  BOX_CACHE.set(pageNumber, resolved);
  return resolved;
};

import { Asset } from "expo-asset";
import { QURAN_SVG_ASSET_MODULES } from "../assets/quran-svgs/pages-manifest";

const PAGE_SVGS = new Map<number, string>();
const PAGE_LOADS = new Map<number, Promise<string | null>>();
const PAGE_ASSET_DOWNLOADS = new Map<number, Promise<string | null>>();
const PAGE_ASSET_URIS = new Map<number, string>();
const MAX_CACHED_SVG_PAGES = 24;
const STARTUP_WARMUP_CHUNK_SIZE = 2;
const STARTUP_WARMUP_STAGGER_MS = 75;
let startupWarmupPromise: Promise<void> | null = null;
let hasCompletedStartupWarmup = false;

const touchSvgCache = (pageNumber: number, xml: string) => {
  if (PAGE_SVGS.has(pageNumber)) {
    PAGE_SVGS.delete(pageNumber);
  }
  PAGE_SVGS.set(pageNumber, xml);

  while (PAGE_SVGS.size > MAX_CACHED_SVG_PAGES) {
    const oldestKey = PAGE_SVGS.keys().next().value as number | undefined;
    if (oldestKey === undefined) break;
    PAGE_SVGS.delete(oldestKey);
  }
};

const hasAssetModule = (pageNumber: number) =>
  Boolean(QURAN_SVG_ASSET_MODULES[pageNumber]);

export const QURAN_PAGE_NUMBERS = Object.keys(QURAN_SVG_ASSET_MODULES)
  .map((key) => Number(key))
  .filter((num) => Number.isFinite(num))
  .sort((a, b) => a - b);

const getOrderedPagesFromCenter = (pageNumbers: number[], startPage?: number) => {
  const sorted = [...pageNumbers].sort((a, b) => a - b);
  if (!sorted.length) return sorted;
  if (!Number.isFinite(startPage)) return sorted;
  const centerPage = Math.floor(Number(startPage));

  let centerIndex = sorted.indexOf(centerPage);
  if (centerIndex < 0) {
    centerIndex = sorted.findIndex((num) => num >= centerPage);
    if (centerIndex < 0) {
      centerIndex = sorted.length - 1;
    }
  }

  const ordered: number[] = [];
  for (let offset = 0; offset < sorted.length; offset += 1) {
    const left = centerIndex - offset;
    const right = centerIndex + offset;

    if (left >= 0) {
      ordered.push(sorted[left]);
    }
    if (offset > 0 && right < sorted.length) {
      ordered.push(sorted[right]);
    }
  }

  return ordered;
};

export const getCachedQuranPageSvgXml = (pageNumber: number): string | null => {
  if (!Number.isFinite(pageNumber) || pageNumber < 1) return null;

  const xml = PAGE_SVGS.get(pageNumber);
  if (xml == null) return null;

  touchSvgCache(pageNumber, xml);
  return xml;
};

const downloadSvgAsset = async (pageNumber: number): Promise<string | null> => {
  const cachedUri = PAGE_ASSET_URIS.get(pageNumber);
  if (cachedUri) return cachedUri;

  if (PAGE_ASSET_DOWNLOADS.has(pageNumber)) {
    return PAGE_ASSET_DOWNLOADS.get(pageNumber) ?? null;
  }

  const promise = (async () => {
    const moduleId = QURAN_SVG_ASSET_MODULES[pageNumber];
    if (!moduleId) return null;

    try {
      const asset = Asset.fromModule(moduleId);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      if (uri) {
        PAGE_ASSET_URIS.set(pageNumber, uri);
      }
      return uri ?? null;
    } catch (error) {
      console.error(`Failed to download SVG asset for page ${pageNumber}:`, error);
      return null;
    } finally {
      PAGE_ASSET_DOWNLOADS.delete(pageNumber);
    }
  })();

  PAGE_ASSET_DOWNLOADS.set(pageNumber, promise);
  return promise;
};

const loadSvgXml = async (pageNumber: number): Promise<string | null> => {
  const cached = getCachedQuranPageSvgXml(pageNumber);
  if (cached != null) return cached;

  if (PAGE_LOADS.has(pageNumber)) {
    return PAGE_LOADS.get(pageNumber) ?? null;
  }

  const promise = (async () => {
    try {
      const uri = await downloadSvgAsset(pageNumber);
      if (!uri) return null;

      const response = await fetch(uri);
      const xml = await response.text();
      touchSvgCache(pageNumber, xml);
      return xml;
    } catch (error) {
      console.error(`Failed to load SVG page ${pageNumber}:`, error);
      return null;
    } finally {
      PAGE_LOADS.delete(pageNumber);
    }
  })();

  PAGE_LOADS.set(pageNumber, promise);
  return promise;
};

export const loadQuranPageSvgXml = async (
  pageNumber: number
): Promise<string | null> => {
  if (!Number.isFinite(pageNumber) || pageNumber < 1) return null;
  if (!hasAssetModule(pageNumber)) return null;
  return loadSvgXml(pageNumber);
};

type StartupWarmupOptions = {
  chunkSize?: number;
  pageNumbers?: number[];
  staggerMs?: number;
  startPage?: number;
};

/**
 * Starts downloading Quran SVG assets in parallel batches.
 * This is intended for app startup so later page loads render faster.
 */
export const warmupQuranSvgAssetsInBackground = ({
  chunkSize = STARTUP_WARMUP_CHUNK_SIZE,
  staggerMs = STARTUP_WARMUP_STAGGER_MS,
  pageNumbers = QURAN_PAGE_NUMBERS,
  startPage,
}: StartupWarmupOptions = {}): Promise<void> => {
  if (hasCompletedStartupWarmup) {
    return Promise.resolve();
  }

  if (startupWarmupPromise) {
    return startupWarmupPromise;
  }

  const unique = Array.from(
    new Set(
      pageNumbers.filter(
        (num) => Number.isFinite(num) && num > 0 && hasAssetModule(num)
      )
    )
  );
  const orderedPages = getOrderedPagesFromCenter(unique, startPage);
  const safeChunkSize = Math.max(1, Math.floor(chunkSize));
  const safeStaggerMs = Math.max(0, Math.floor(staggerMs));

  startupWarmupPromise = (async () => {
    for (let i = 0; i < orderedPages.length; i += safeChunkSize) {
      const chunk = orderedPages.slice(i, i + safeChunkSize);
      await Promise.all(chunk.map((pageNumber) => downloadSvgAsset(pageNumber)));

      if (safeStaggerMs > 0 && i + safeChunkSize < orderedPages.length) {
        await new Promise((resolve) => setTimeout(resolve, safeStaggerMs));
      }
    }
  })().finally(() => {
    hasCompletedStartupWarmup = true;
    startupWarmupPromise = null;
  });

  return startupWarmupPromise;
};

type PrefetchOptions = {
  chunkSize?: number;
  staggerMs?: number;
};

/**
 * Warm up the SVG cache without blocking the JS thread for too long.
 * Returns a cancel function to stop any remaining work (use on unmount).
 */
export const prefetchQuranPageSvgs = (
  pageNumbers: number[],
  { chunkSize = 4, staggerMs = 10 }: PrefetchOptions = {}
): (() => void) => {
  if (!pageNumbers.length) return () => {};

  const unique = Array.from(
    new Set(
      pageNumbers.filter(
        (num) => Number.isFinite(num) && num > 0 && hasAssetModule(num)
      )
    )
  ).filter((num) => !PAGE_SVGS.has(num));

  if (!unique.length) return () => {};

  let cancelled = false;

  const run = async () => {
    for (let i = 0; i < unique.length && !cancelled; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      await Promise.all(chunk.map((pageNumber) => loadSvgXml(pageNumber)));

      if (staggerMs > 0 && i + chunkSize < unique.length) {
        await new Promise((resolve) => setTimeout(resolve, staggerMs));
      }
    }
  };

  run();

  return () => {
    cancelled = true;
  };
};

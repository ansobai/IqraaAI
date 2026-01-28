import { Asset } from "expo-asset";
import { QURAN_SVG_ASSET_MODULES } from "../assets/quran-svgs/pages-manifest";

const PAGE_SVGS = new Map<number, string>();
const PAGE_LOADS = new Map<number, Promise<string | null>>();

const hasAssetModule = (pageNumber: number) =>
  Boolean(QURAN_SVG_ASSET_MODULES[pageNumber]);

export const QURAN_PAGE_NUMBERS = Object.keys(QURAN_SVG_ASSET_MODULES)
  .map((key) => Number(key))
  .filter((num) => Number.isFinite(num))
  .sort((a, b) => a - b);

const loadSvgXml = async (pageNumber: number): Promise<string | null> => {
  if (PAGE_SVGS.has(pageNumber)) {
    return PAGE_SVGS.get(pageNumber) ?? null;
  }

  if (PAGE_LOADS.has(pageNumber)) {
    return PAGE_LOADS.get(pageNumber) ?? null;
  }

  const promise = (async () => {
    const moduleId = QURAN_SVG_ASSET_MODULES[pageNumber];
    if (!moduleId) return null;

    try {
      const asset = Asset.fromModule(moduleId);
      await asset.downloadAsync();

      const uri = asset.localUri ?? asset.uri;
      if (!uri) return null;

      const response = await fetch(uri);
      const xml = await response.text();
      PAGE_SVGS.set(pageNumber, xml);
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

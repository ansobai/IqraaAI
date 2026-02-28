type FetchMuyassarTafsirArgs = {
  surahId: number;
  verseNumber: string | number;
  signal?: AbortSignal;
};

type MuyassarApiResponse = {
  data?: {
    text?: unknown;
  };
};

const TAFSIR_API_BASE = "https://api.alquran.cloud/v1/ayah";

export const MAX_CACHED_TAFSIR_ENTRIES = 120;

const TAFSIR_CACHE = new Map<string, string>();
const IN_FLIGHT_TAFSIR_REQUESTS = new Map<string, Promise<string>>();

const ABORT_ERROR_NAME = "AbortError";

const createAbortError = () => {
  const error = new Error("The operation was aborted");
  error.name = ABORT_ERROR_NAME;
  return error;
};

const withAbortSignal = async <T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) throw createAbortError();

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
};

const parsePositiveInteger = (
  value: string | number,
  fieldName: string,
): number => {
  if (typeof value === "number") {
    if (Number.isInteger(value) && value > 0) return value;
    throw new Error(`${fieldName} must be a positive integer`);
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  const numeric = Number(trimmed);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return numeric;
};

const makeCacheKey = (surahId: number, ayahNumber: number) =>
  `${surahId}:${ayahNumber}`;

const touchCacheEntry = (key: string, value: string) => {
  if (TAFSIR_CACHE.has(key)) {
    TAFSIR_CACHE.delete(key);
  }
  TAFSIR_CACHE.set(key, value);
};

const getCachedTafsir = (key: string): string | null => {
  const cached = TAFSIR_CACHE.get(key);
  if (cached == null) return null;
  touchCacheEntry(key, cached);
  return cached;
};

const setCachedTafsir = (key: string, value: string) => {
  touchCacheEntry(key, value);

  while (TAFSIR_CACHE.size > MAX_CACHED_TAFSIR_ENTRIES) {
    const oldestKey = TAFSIR_CACHE.keys().next().value as string | undefined;
    if (!oldestKey) break;
    TAFSIR_CACHE.delete(oldestKey);
  }
};

const parseErrorMessageFromResponse = async (response: Response) => {
  try {
    const payload = (await response.json()) as { data?: unknown; status?: unknown };
    if (typeof payload?.data === "string" && payload.data.length > 0) {
      return payload.data;
    }
    if (typeof payload?.status === "string" && payload.status.length > 0) {
      return payload.status;
    }
  } catch {
    // Ignore JSON parse failures.
  }

  return `Request failed (${response.status})`;
};

const requestMuyassarTafsir = async (
  surahId: number,
  ayahNumber: number,
): Promise<string> => {
  const endpoint = `${TAFSIR_API_BASE}/${surahId}:${ayahNumber}/ar.muyassar`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(await parseErrorMessageFromResponse(response));
  }

  const payload = (await response.json()) as MuyassarApiResponse;
  const text = payload?.data?.text;

  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("Invalid Muyassar tafsir response");
  }

  return text;
};

export const fetchMuyassarTafsir = async ({
  surahId,
  verseNumber,
  signal,
}: FetchMuyassarTafsirArgs): Promise<string> => {
  const safeSurahId = parsePositiveInteger(surahId, "surahId");
  const safeVerseNumber = parsePositiveInteger(verseNumber, "verseNumber");
  const cacheKey = makeCacheKey(safeSurahId, safeVerseNumber);

  const cached = getCachedTafsir(cacheKey);
  if (cached != null) {
    return withAbortSignal(Promise.resolve(cached), signal);
  }

  const inFlight = IN_FLIGHT_TAFSIR_REQUESTS.get(cacheKey);
  if (inFlight) {
    return withAbortSignal(inFlight, signal);
  }

  const requestPromise = requestMuyassarTafsir(safeSurahId, safeVerseNumber)
    .then((text) => {
      setCachedTafsir(cacheKey, text);
      return text;
    })
    .finally(() => {
      IN_FLIGHT_TAFSIR_REQUESTS.delete(cacheKey);
    });

  IN_FLIGHT_TAFSIR_REQUESTS.set(cacheKey, requestPromise);

  return withAbortSignal(requestPromise, signal);
};

export const clearMuyassarTafsirSessionCache = () => {
  TAFSIR_CACHE.clear();
  IN_FLIGHT_TAFSIR_REQUESTS.clear();
};

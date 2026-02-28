import assert from "node:assert/strict";
import test from "node:test";

import {
  clearMuyassarTafsirSessionCache,
  fetchMuyassarTafsir,
  MAX_CACHED_TAFSIR_ENTRIES,
} from "./tafsirApi";

const originalFetch = globalThis.fetch;

const toUrlString = (input: RequestInfo | URL) => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

const extractReferenceFromUrl = (url: string) => {
  const match = url.match(/\/ayah\/(\d+:\d+)\/ar\.muyassar$/);
  assert.ok(match, `Unexpected tafsir URL: ${url}`);
  return match[1];
};

const createSuccessResponse = (text: string) =>
  new Response(
    JSON.stringify({
      code: 200,
      status: "OK",
      data: {
        text,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  clearMuyassarTafsirSessionCache();
});

test("returns tafsir text and reuses session cache for same verse", async () => {
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return createSuccessResponse("cached-tafsir");
  }) as typeof fetch;

  const first = await fetchMuyassarTafsir({ surahId: 2, verseNumber: 255 });
  const second = await fetchMuyassarTafsir({ surahId: 2, verseNumber: "255" });

  assert.equal(first, "cached-tafsir");
  assert.equal(second, "cached-tafsir");
  assert.equal(fetchCalls, 1);
});

test("dedupes in-flight requests for the same verse", async () => {
  let fetchCalls = 0;
  let resolveFetch: (response: Response) => void = () => {
    throw new Error("Expected fetch resolver to be initialized");
  };

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
  }) as typeof fetch;

  const promiseA = fetchMuyassarTafsir({ surahId: 1, verseNumber: 1 });
  const promiseB = fetchMuyassarTafsir({ surahId: 1, verseNumber: 1 });

  assert.equal(fetchCalls, 1);

  resolveFetch(createSuccessResponse("deduped-tafsir"));
  const [tafsirA, tafsirB] = await Promise.all([promiseA, promiseB]);

  assert.equal(tafsirA, "deduped-tafsir");
  assert.equal(tafsirB, "deduped-tafsir");
});

test("validates surah and ayah identifiers as positive integers", async () => {
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return createSuccessResponse("should-not-be-used");
  }) as typeof fetch;

  await assert.rejects(
    () => fetchMuyassarTafsir({ surahId: 0, verseNumber: 1 }),
    /surahId must be a positive integer/,
  );

  await assert.rejects(
    () => fetchMuyassarTafsir({ surahId: 1, verseNumber: "abc" }),
    /verseNumber must be a positive integer/,
  );

  assert.equal(fetchCalls, 0);
});

test("throws when API response is non-OK", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: "not-found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  await assert.rejects(
    () => fetchMuyassarTafsir({ surahId: 2, verseNumber: 999 }),
    /not-found/,
  );
});

test("does not cache failures and succeeds on next successful retry", async () => {
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;

    if (fetchCalls === 1) {
      return new Response(JSON.stringify({ status: "temporary-failure" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    return createSuccessResponse("retried-successfully");
  }) as typeof fetch;

  await assert.rejects(
    () => fetchMuyassarTafsir({ surahId: 36, verseNumber: 58 }),
    /temporary-failure/,
  );

  const retried = await fetchMuyassarTafsir({ surahId: 36, verseNumber: 58 });

  assert.equal(retried, "retried-successfully");
  assert.equal(fetchCalls, 2);
});

test("evicts least recently used entry when cache size exceeds limit", async () => {
  const callCountByReference = new Map<string, number>();

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = toUrlString(input);
    const reference = extractReferenceFromUrl(url);

    callCountByReference.set(
      reference,
      (callCountByReference.get(reference) ?? 0) + 1,
    );

    return createSuccessResponse(`tafsir-${reference}`);
  }) as typeof fetch;

  for (let ayah = 1; ayah <= MAX_CACHED_TAFSIR_ENTRIES + 1; ayah += 1) {
    await fetchMuyassarTafsir({ surahId: 2, verseNumber: ayah });
  }

  assert.equal(callCountByReference.get("2:1"), 1);
  assert.equal(callCountByReference.get("2:2"), 1);

  await fetchMuyassarTafsir({ surahId: 2, verseNumber: 2 });
  await fetchMuyassarTafsir({ surahId: 2, verseNumber: 1 });

  assert.equal(callCountByReference.get("2:2"), 1);
  assert.equal(callCountByReference.get("2:1"), 2);
});

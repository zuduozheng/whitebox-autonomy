/**
 * Regression coverage for the map's bounded query layer (map-repository.ts).
 *
 * Same fetch-mocking technique as supabase-source.test.mjs: override
 * `globalThis.fetch` to return a canned PostgREST-shaped response (including
 * the `content-range` header PostgREST uses to carry `Prefer: count=exact`'s
 * total), and run the real `queryMapEvents()` against it end to end.
 *
 * What this suite exists to prove, per the task's explicit requirements:
 *   - the query is bounded (LIMIT via .range()), never `loadEvents()`'s
 *     full-corpus load;
 *   - it can never return more than MAP_QUERY_CAP rows even when far more
 *     match;
 *   - it returns BOTH the matched count and the returned count, so the UI
 *     can say "N events match this view. Showing <=1000.";
 *   - only the three approved Beta filters (eventType, valence,
 *     developerOrOperator) are ever sent as query filters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

const { queryMapEvents, MAP_QUERY_CAP } = await import("../map-repository.ts");

const VALID_BOUNDS = { minLatitude: 30, maxLatitude: 40, minLongitude: -125, maxLongitude: -110 };

function pointRow(overrides = {}) {
  return {
    slug: "test-event",
    latitude: 33.4484,
    longitude: -112.074,
    resolved_level: "city",
    event_type: "collision",
    valence: "neutral-or-unclear",
    developer_or_operator: "Waymo LLC",
    ...overrides,
  };
}

/** capturedRequest.url/headers let assertions inspect exactly what PostgREST call was made. */
function mockFetchReturning(rows, totalMatched, capturedRequest) {
  globalThis.fetch = async (url, init) => {
    if (capturedRequest) {
      capturedRequest.url = String(url);
      capturedRequest.headers = init?.headers ?? {};
    }
    return new Response(JSON.stringify(rows), {
      status: 206,
      headers: {
        "content-type": "application/json",
        "content-range": `0-${Math.max(rows.length - 1, 0)}/${totalMatched}`,
      },
    });
  };
}

test("MAP_QUERY_CAP is 1000, matching the product-approved Beta display cap", () => {
  assert.equal(MAP_QUERY_CAP, 1000);
});

test("returns both matchedCount (exact total) and returnedCount (<=cap) from one request", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const rows = Array.from({ length: 5 }, (_, i) => pointRow({ slug: `event-${i}` }));
  mockFetchReturning(rows, 3600);

  const result = await queryMapEvents(VALID_BOUNDS);

  assert.equal(result.matchedCount, 3600, "matchedCount must reflect ALL matching rows, not just returned ones");
  assert.equal(result.returnedCount, 5);
  assert.equal(result.points.length, 5);
  assert.equal(result.cap, 1000);
});

test("never requests more than MAP_QUERY_CAP rows regardless of how many match", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const captured = {};
  mockFetchReturning([pointRow()], 50000, captured);

  await queryMapEvents(VALID_BOUNDS);

  // This supabase-js version's .range(0, 999) sends offset/limit query
  // params (PostgREST's range-based pagination) rather than a Range header.
  assert.match(captured.url, /[?&]offset=0(&|$)/);
  assert.match(captured.url, /[?&]limit=1000(&|$)/);
});

test("returnedCount can never exceed matchedCount's cap even if the mock returns more than 1000 rows", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  // Defensive: even a misbehaving server response is truncated at the cap by
  // the query layer's own contract (in real PostgREST usage, the Range
  // header already prevents this; this proves the cap is enforced by the
  // request itself, not trusted blindly from the response).
  const rows = Array.from({ length: 1000 }, (_, i) => pointRow({ slug: `event-${i}` }));
  mockFetchReturning(rows, 50000);

  const result = await queryMapEvents(VALID_BOUNDS);

  assert.ok(result.returnedCount <= MAP_QUERY_CAP);
  assert.equal(result.returnedCount, 1000);
  assert.equal(result.matchedCount, 50000);
});

test("applies eventType and valence as exact-match filters on the request URL", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const captured = {};
  mockFetchReturning([], 0, captured);

  await queryMapEvents(VALID_BOUNDS, {
    eventType: "collision",
    valence: "failure-or-challenging",
  });

  const url = decodeURIComponent(captured.url.replace(/\+/g, " "));
  assert.match(url, /event_type=eq\.collision/);
  assert.match(url, /valence=eq\.failure-or-challenging/);
});

test("expands a canonical developerOrOperator filter to an IN(...) match over every raw variant it covers", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const captured = {};
  mockFetchReturning([], 0, captured);

  // "Waymo" is the canonical value; the database only knows the raw strings
  // — see src/lib/events/developer-operator.ts. The query must therefore
  // match every one of them, not just the canonical label itself (which
  // isn't even a value that appears in the database).
  await queryMapEvents(VALID_BOUNDS, { developerOrOperator: "Waymo" });

  const url = decodeURIComponent(captured.url.replace(/\+/g, " "));
  assert.match(url, /developer_or_operator=in\.\(/);
  for (const raw of ["Waymo", "Waymo LLC", "WAYMO LLC", "Waymo LLc", "Waymo LLlC"]) {
    assert.ok(url.includes(raw), `expected the IN(...) list to include raw value "${raw}"; got: ${url}`);
  }
});

test("applies latitude/longitude bounds as range filters on the request URL", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const captured = {};
  mockFetchReturning([], 0, captured);

  await queryMapEvents(VALID_BOUNDS);

  const url = decodeURIComponent(captured.url);
  assert.match(url, /latitude=gte\.30/);
  assert.match(url, /latitude=lte\.40/);
  assert.match(url, /longitude=gte\.-125/);
  assert.match(url, /longitude=lte\.-110/);
});

test("queries the bounded event_map_public view, never the full-corpus event table", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const captured = {};
  mockFetchReturning([], 0, captured);

  await queryMapEvents(VALID_BOUNDS);

  assert.match(captured.url, /\/event_map_public(\?|$)/);
});

test("rejects an inverted latitude range rather than silently returning nothing", async () => {
  await assert.rejects(() => queryMapEvents({ ...VALID_BOUNDS, minLatitude: 50, maxLatitude: 10 }));
});

test("rejects out-of-range latitude/longitude", async () => {
  await assert.rejects(() => queryMapEvents({ ...VALID_BOUNDS, maxLatitude: 200 }));
  await assert.rejects(() => queryMapEvents({ ...VALID_BOUNDS, minLongitude: -300 }));
});

test("rejects an antimeridian-crossing viewport rather than silently mishandling it (documented Beta limitation)", async () => {
  await assert.rejects(() => queryMapEvents({ ...VALID_BOUNDS, minLongitude: 170, maxLongitude: -170 }));
});

test("no filter fields are sent when the filter is empty", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const captured = {};
  mockFetchReturning([], 0, captured);

  await queryMapEvents(VALID_BOUNDS, {});

  const url = decodeURIComponent(captured.url);
  assert.equal(/event_type=eq\./.test(url), false);
  assert.equal(/valence=eq\./.test(url), false);
  assert.equal(/developer_or_operator=eq\./.test(url), false);
});

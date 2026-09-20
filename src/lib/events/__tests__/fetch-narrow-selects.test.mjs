/**
 * Regression coverage for the two other PostgREST-egress fixes:
 * fetchEventSlugs() (sitemap.ts / generateStaticParams) and
 * fetchDeveloperOrOperatorRawValues() (the map page's dropdown) — both used
 * to go through loadEvents()'s full ~23-field, nested-source corpus load
 * just to extract one column. Same fetch-mocking technique as
 * pagination.test.mjs: override `globalThis.fetch`, inspect request URLs,
 * and run the real, unmodified functions end to end.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

const { fetchEventSlugs, fetchDeveloperOrOperatorRawValues, EVENT_PAGE_SIZE } = await import(
  "../supabase-source.ts"
);

function pad(n) {
  return String(n).padStart(7, "0");
}

function slugRow(n) {
  return { slug: `event-${pad(n)}` };
}

function devRow(n, developerOrOperator) {
  return { slug: `event-${pad(n)}`, developer_or_operator: developerOrOperator };
}

/** Serves `pages[0]`, `pages[1]`, ... in call order; `[]` once exhausted. Captures each request URL. */
function mockFetchReturningPages(pages, capturedUrls) {
  let calls = 0;
  globalThis.fetch = async (url) => {
    if (capturedUrls) capturedUrls.push(String(url));
    const body = pages[calls] ?? [];
    calls++;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { callCount: () => calls };
}

function withRestoredFetch(t) {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
}

// --- fetchEventSlugs -------------------------------------------------------

test("fetchEventSlugs requests only the slug column — not the full EVENT_SELECT field list or nested sources", async (t) => {
  withRestoredFetch(t);
  const urls = [];
  mockFetchReturningPages([[slugRow(0)]], urls);

  await fetchEventSlugs();

  const url = decodeURIComponent(urls[0]);
  assert.match(url, /select=slug(&|$)/);
  assert.doesNotMatch(url, /event_source/);
  assert.doesNotMatch(url, /summary/);
  assert.doesNotMatch(url, /observed_facts/);
});

test("fetchEventSlugs requests slug-ascending order from the server, same as loadEvents()", async (t) => {
  withRestoredFetch(t);
  const urls = [];
  mockFetchReturningPages([[]], urls);

  await fetchEventSlugs();

  const url = decodeURIComponent(urls[0]);
  assert.match(url, /order=slug\.asc/);
});

test("fetchEventSlugs paginates past PostgREST's 1000-row cap, same mechanics as loadEvents()", async (t) => {
  withRestoredFetch(t);
  const page0 = Array.from({ length: EVENT_PAGE_SIZE }, (_, i) => slugRow(i));
  const page1 = Array.from({ length: 5 }, (_, i) => slugRow(EVENT_PAGE_SIZE + i));
  const tracker = mockFetchReturningPages([page0, page1]);

  const slugs = await fetchEventSlugs();

  assert.equal(slugs.length, EVENT_PAGE_SIZE + 5);
  assert.equal(tracker.callCount(), 2);
});

test("fetchEventSlugs returns exactly the slugs the server sent, in the same order", async (t) => {
  withRestoredFetch(t);
  mockFetchReturningPages([[slugRow(0), slugRow(1), slugRow(2)]]);

  const slugs = await fetchEventSlugs();

  assert.deepEqual(slugs, ["event-0000000", "event-0000001", "event-0000002"]);
});

test("fetchEventSlugs rejects a null slug rather than silently dropping it", async (t) => {
  withRestoredFetch(t);
  mockFetchReturningPages([[{ slug: null }]]);

  await assert.rejects(() => fetchEventSlugs(), /missing or empty "slug"/);
});

test("fetchEventSlugs propagates a PostgREST error, same as loadEvents()", async (t) => {
  withRestoredFetch(t);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "simulated failure", code: "PGRST000" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

  await assert.rejects(() => fetchEventSlugs(), /Failed to load events from Supabase \(PGRST000\)/);
});

// --- fetchDeveloperOrOperatorRawValues -------------------------------------

test("fetchDeveloperOrOperatorRawValues requests only slug + developer_or_operator, not the full event or nested sources", async (t) => {
  withRestoredFetch(t);
  const urls = [];
  mockFetchReturningPages([[devRow(0, "Waymo LLC")]], urls);

  await fetchDeveloperOrOperatorRawValues();

  const url = decodeURIComponent(urls[0]);
  assert.match(url, /select=slug,developer_or_operator(&|$)/);
  assert.doesNotMatch(url, /event_source/);
  assert.doesNotMatch(url, /summary/);
});

test("fetchDeveloperOrOperatorRawValues returns one raw value per event, NOT deduplicated (dedup stays repository.ts's job)", async (t) => {
  withRestoredFetch(t);
  mockFetchReturningPages([[devRow(0, "Waymo LLC"), devRow(1, "Waymo LLC"), devRow(2, "Tesla Inc")]]);

  const values = await fetchDeveloperOrOperatorRawValues();

  assert.deepEqual(values, ["Waymo LLC", "Waymo LLC", "Tesla Inc"]);
});

test("fetchDeveloperOrOperatorRawValues paginates past PostgREST's 1000-row cap", async (t) => {
  withRestoredFetch(t);
  const page0 = Array.from({ length: EVENT_PAGE_SIZE }, (_, i) => devRow(i, "Waymo LLC"));
  const page1 = Array.from({ length: 3 }, (_, i) => devRow(EVENT_PAGE_SIZE + i, "Tesla Inc"));
  const tracker = mockFetchReturningPages([page0, page1]);

  const values = await fetchDeveloperOrOperatorRawValues();

  assert.equal(values.length, EVENT_PAGE_SIZE + 3);
  assert.equal(tracker.callCount(), 2);
});

test("fetchDeveloperOrOperatorRawValues rejects a null developer_or_operator rather than silently dropping it", async (t) => {
  withRestoredFetch(t);
  mockFetchReturningPages([[devRow(0, null)]]);

  await assert.rejects(
    () => fetchDeveloperOrOperatorRawValues(),
    /missing or empty "developer_or_operator"/,
  );
});

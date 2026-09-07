/**
 * Regression coverage for the PostgREST default row-cap defect: an
 * unpaginated `select()` silently returns at most 1000 rows (HTTP 206, no
 * error) — invisible while the corpus stayed under that cap, and exactly
 * what let the NHTSA publication (2923 total public events) go live with
 * 1923 events unreachable through the public site. Tested through the real,
 * unmodified `loadEvents()` (same mocked-fetch technique as
 * supabase-source.test.mjs), never a test-only pagination helper.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

const { loadEvents, EVENT_PAGE_SIZE } = await import("../supabase-source.ts");

const CANONICAL_URL =
  "https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting";

function pad(n) {
  return String(n).padStart(7, "0");
}

/** One fully-valid row with a unique, ascending-sortable slug. */
function makeRow(n, overrides = {}) {
  return {
    slug: `event-${pad(n)}`,
    title: `Event ${n}`,
    summary: "Test summary.",
    occurred_on: "2024-01-01",
    occurred_on_precision: "day",
    location_text: null,
    location_country_code: null,
    location_precision: "unknown",
    developer_or_operator: "Test Operator",
    system_name: null,
    automation_status: "unknown",
    system_version: null,
    system_version_knowledge: "unknown",
    event_type: "collision",
    valence: "neutral-or-unclear",
    observed_facts: ["A fact."],
    unknowns: [],
    interpretation: null,
    causation_status: "undetermined",
    causation_note: null,
    review_status: "curator-reviewed",
    origin: "curated",
    record_updated: "2024-01-02",
    sources: [
      {
        url: CANONICAL_URL,
        source_type: "other",
        publisher: null,
        label: null,
        published_on: null,
        published_on_precision: "unknown",
        retrieved_on: null,
        note: null,
      },
    ],
    ...overrides,
  };
}

function makeRows(start, count, overrides) {
  return Array.from({ length: count }, (_, i) => makeRow(start + i, overrides));
}

/** Serves `pages[0]`, `pages[1]`, ... in call order; `[]` once exhausted. */
function mockFetchReturningPages(pages) {
  let calls = 0;
  globalThis.fetch = async () => {
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
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

test("fewer than one page: returns all rows and performs exactly one request", async (t) => {
  withRestoredFetch(t);
  const tracker = mockFetchReturningPages([makeRows(0, 5)]);

  const events = await loadEvents();

  assert.equal(events.length, 5);
  assert.equal(tracker.callCount(), 1);
});

test("exactly one full page: performs a follow-up request that terminates on an empty page", async (t) => {
  withRestoredFetch(t);
  const fullPage = makeRows(0, EVENT_PAGE_SIZE);
  const tracker = mockFetchReturningPages([fullPage, []]);

  const events = await loadEvents();

  assert.equal(events.length, EVENT_PAGE_SIZE);
  assert.equal(tracker.callCount(), 2);
});

test("more than one page: returns the full corpus (1000+1000+923=2923) in slug order", async (t) => {
  withRestoredFetch(t);
  const page0 = makeRows(0, EVENT_PAGE_SIZE);
  const page1 = makeRows(EVENT_PAGE_SIZE, EVENT_PAGE_SIZE);
  const page2 = makeRows(EVENT_PAGE_SIZE * 2, 923);
  const tracker = mockFetchReturningPages([page0, page1, page2]);

  const events = await loadEvents();

  assert.equal(events.length, EVENT_PAGE_SIZE * 2 + 923);
  // The third page is short (923 < 1000), so pagination stops without a 4th
  // request — never inferring completion from an assumed total count.
  assert.equal(tracker.callCount(), 3);
  const slugs = events.map((e) => e.slug);
  assert.deepEqual(
    slugs,
    [...slugs].sort(),
    "events must come back in ascending slug order across page boundaries",
  );
});

test("page boundary: the last row of one page and the first row of the next are each retained exactly once", async (t) => {
  withRestoredFetch(t);
  const page0 = makeRows(0, EVENT_PAGE_SIZE);
  const page1 = makeRows(EVENT_PAGE_SIZE, 10);
  mockFetchReturningPages([page0, page1]);

  const events = await loadEvents();
  const slugs = events.map((e) => e.slug);

  assert.equal(events.length, EVENT_PAGE_SIZE + 10);
  assert.equal(slugs.filter((s) => s === page0[page0.length - 1].slug).length, 1);
  assert.equal(slugs.filter((s) => s === page1[0].slug).length, 1);
});

test("a failure on a later page rejects the whole call — never returns the earlier pages' rows", async (t) => {
  withRestoredFetch(t);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return new Response(JSON.stringify(makeRows(0, EVENT_PAGE_SIZE)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ message: "simulated later-page failure", code: "PGRST000" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  };

  await assert.rejects(() => loadEvents(), /Failed to load events from Supabase \(PGRST000\)/);
});

test("a malformed event on a later page still fails validation (pagination does not weaken parsing)", async (t) => {
  withRestoredFetch(t);
  const page0 = makeRows(0, EVENT_PAGE_SIZE);
  const page1 = makeRows(EVENT_PAGE_SIZE, 5);
  page1[2] = { ...page1[2], event_type: "not-a-real-type" };
  mockFetchReturningPages([page0, page1]);

  await assert.rejects(() => loadEvents(), /"event_type" has unexpected value/);
});

test("source-derived nullable fields (summary/review_status/observed_facts) remain accepted on a later page", async (t) => {
  withRestoredFetch(t);
  const page0 = makeRows(0, EVENT_PAGE_SIZE);
  const page1 = makeRows(EVENT_PAGE_SIZE, 3, {
    origin: "source-derived",
    summary: null,
    review_status: null,
    observed_facts: [],
  });
  mockFetchReturningPages([page0, page1]);

  const events = await loadEvents();
  const laterPageEvents = events.slice(EVENT_PAGE_SIZE);

  assert.equal(laterPageEvents.length, 3);
  for (const event of laterPageEvents) {
    assert.equal(event.origin, "source-derived");
    assert.equal(event.summary, null);
    assert.equal(event.reviewStatus, null);
    assert.deepEqual(event.observedFacts, []);
  }
});

test("a duplicate slug across page boundaries is rejected, never silently deduplicated", async (t) => {
  withRestoredFetch(t);
  const page0 = makeRows(0, EVENT_PAGE_SIZE);
  const page1 = makeRows(EVENT_PAGE_SIZE, 5);
  page1[0] = { ...page1[0], slug: page0[0].slug };
  mockFetchReturningPages([page0, page1]);

  await assert.rejects(() => loadEvents(), /Duplicate event slug/);
});

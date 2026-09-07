/**
 * Regression coverage for the regulatory-record source-type gap, tested
 * through the real, already-exported public API (`loadEvents`) exactly as
 * `repository.ts` uses it — no test-only exports of internal helpers.
 *
 * `loadEvents()` makes one network call via `@supabase/supabase-js`, which
 * (per node_modules/@supabase/postgrest-js) issues a plain `fetch()` per
 * query. Overriding `globalThis.fetch` intercepts that call and returns a
 * canned PostgREST-shaped response, so the real mapping/validation code in
 * supabase-source.ts runs end to end against a fixture we control.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

const { loadEvents } = await import("../supabase-source.ts");

const CANONICAL_URL =
  "https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting";

function eventRow({ sourceType, ...overrides }) {
  return {
    slug: "test-event",
    title: "Test event",
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
        source_type: sourceType,
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

function mockFetchReturning(rows) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

test("loadEvents() succeeds for an event whose source has source_type=regulatory-record", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  mockFetchReturning([eventRow({ sourceType: "regulatory-record" })]);

  const events = await loadEvents();

  assert.equal(events.length, 1);
  assert.equal(events[0].sources.length, 1);
  assert.equal(events[0].sources[0].type, "regulatory-record");
  assert.equal(events[0].sources[0].url, CANONICAL_URL);
});

test("loadEvents() still succeeds for every pre-existing source_type", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  for (const sourceType of ["x-post", "youtube-video", "news-article", "official-report", "other"]) {
    mockFetchReturning([eventRow({ sourceType })]);
    const events = await loadEvents();
    assert.equal(events[0].sources[0].type, sourceType);
  }
});

test("loadEvents() still rejects a source_type outside the controlled vocabulary", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  mockFetchReturning([eventRow({ sourceType: "not-a-real-type" })]);

  await assert.rejects(() => loadEvents(), /source\.source_type" has unexpected value/);
});

// --- event.origin / source-derived publication (20260908000000_event_origin.sql) ---

test("loadEvents() succeeds for a source-derived event with review_status=null", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  mockFetchReturning([
    eventRow({ sourceType: "regulatory-record", origin: "source-derived", review_status: null }),
  ]);

  const events = await loadEvents();

  assert.equal(events[0].origin, "source-derived");
  assert.equal(events[0].reviewStatus, null);
});

test("loadEvents() succeeds for a source-derived event with summary=null", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  mockFetchReturning([
    eventRow({ sourceType: "regulatory-record", origin: "source-derived", summary: null }),
  ]);

  const events = await loadEvents();

  assert.equal(events[0].origin, "source-derived");
  assert.equal(events[0].summary, null);
});

test("loadEvents() succeeds for a source-derived event with observed_facts=[]", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  mockFetchReturning([
    eventRow({ sourceType: "regulatory-record", origin: "source-derived", observed_facts: [] }),
  ]);

  const events = await loadEvents();

  assert.equal(events[0].origin, "source-derived");
  assert.deepEqual(events[0].observedFacts, []);
});

test("loadEvents() succeeds for a source-derived event with review_status/summary/observed_facts all absent at once", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  mockFetchReturning([
    eventRow({
      sourceType: "regulatory-record",
      origin: "source-derived",
      review_status: null,
      summary: null,
      observed_facts: [],
    }),
  ]);

  const events = await loadEvents();

  assert.equal(events[0].origin, "source-derived");
  assert.equal(events[0].reviewStatus, null);
  assert.equal(events[0].summary, null);
  assert.deepEqual(events[0].observedFacts, []);
});

test("loadEvents() still rejects an invalid non-null review_status, even for a source-derived event", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  mockFetchReturning([
    eventRow({ sourceType: "regulatory-record", origin: "source-derived", review_status: "not-a-real-status" }),
  ]);

  await assert.rejects(() => loadEvents(), /"review_status" has unexpected value/);
});

test("loadEvents() still rejects observed_facts=[] for a curated event", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  mockFetchReturning([eventRow({ sourceType: "other", origin: "curated", observed_facts: [] })]);

  await assert.rejects(() => loadEvents(), /"observed_facts" must be a non-empty array/);
});

test("loadEvents() still rejects an origin value outside the controlled vocabulary", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  mockFetchReturning([eventRow({ sourceType: "other", origin: "not-a-real-origin" })]);

  await assert.rejects(() => loadEvents(), /"origin" has unexpected value/);
});

test("loadEvents() exposes location_precision on an event with a location", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  mockFetchReturning([
    eventRow({
      sourceType: "regulatory-record",
      origin: "source-derived",
      location_text: "Phoenix, AZ",
      location_precision: "city",
    }),
  ]);

  const events = await loadEvents();

  assert.deepEqual(events[0].location, { text: "Phoenix, AZ", precision: "city" });
});

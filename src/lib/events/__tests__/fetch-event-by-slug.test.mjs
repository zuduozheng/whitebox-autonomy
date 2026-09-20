/**
 * Regression coverage for fetchEventBySlug() — the PostgREST-egress fix that
 * replaces "load the full ~2,800-event corpus and find() in memory" with a
 * single server-side-filtered request for exactly one event. Same
 * fetch-mocking technique as supabase-source.test.mjs and
 * map-repository.test.mjs: override `globalThis.fetch`, inspect the request
 * URL, and run the real, unmodified mapping/validation code end to end.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

const { fetchEventBySlug } = await import("../supabase-source.ts");

const CANONICAL_URL =
  "https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting";

function eventRow(overrides = {}) {
  return {
    slug: "target-event",
    title: "Target event",
    summary: "Test summary.",
    occurred_on: "2024-01-01",
    occurred_on_precision: "day",
    location_text: "Phoenix, AZ",
    location_country_code: "US",
    location_precision: "city",
    developer_or_operator: "Waymo LLC",
    system_name: "Waymo Driver",
    automation_status: "driving-automation-engaged-confirmed",
    system_version: "5.0",
    system_version_knowledge: "stated",
    event_type: "collision",
    valence: "neutral-or-unclear",
    observed_facts: ["A fact."],
    unknowns: ["Something unresolved."],
    interpretation: "An interpretation.",
    causation_status: "undetermined",
    causation_note: "A note.",
    review_status: "curator-reviewed",
    origin: "curated",
    record_updated: "2024-01-02",
    sources: [
      {
        url: CANONICAL_URL,
        source_type: "regulatory-record",
        publisher: "NHTSA",
        label: "SGO report",
        published_on: "2024-01-01",
        published_on_precision: "day",
        retrieved_on: "2024-01-03",
        note: "A source note.",
      },
    ],
    ...overrides,
  };
}

/** capturedRequest.url/calls let assertions inspect exactly what was requested. */
function mockFetchReturning(rows, capturedRequest) {
  globalThis.fetch = async (url) => {
    if (capturedRequest) {
      capturedRequest.url = String(url);
      capturedRequest.calls = (capturedRequest.calls ?? 0) + 1;
    }
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function withRestoredFetch(t) {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
}

test("filters by slug at the PostgREST level (eq), not by loading and searching in memory", async (t) => {
  withRestoredFetch(t);
  const captured = {};
  mockFetchReturning([eventRow()], captured);

  await fetchEventBySlug("target-event");

  const url = decodeURIComponent(captured.url);
  assert.match(url, /slug=eq\.target-event/);
});

test("makes exactly one PostgREST request — never the full-corpus pagination loop", async (t) => {
  withRestoredFetch(t);
  const captured = {};
  mockFetchReturning([eventRow()], captured);

  await fetchEventBySlug("target-event");

  assert.equal(captured.calls, 1);
});

test("does not request offset-based pagination (no range/offset params) — a single-row lookup, not a page", async (t) => {
  withRestoredFetch(t);
  const captured = {};
  mockFetchReturning([eventRow()], captured);

  await fetchEventBySlug("target-event");

  const url = decodeURIComponent(captured.url);
  assert.doesNotMatch(url, /offset=/);
});

test("a matching event is transformed identically to loadEvents()'s mapping, including nested sources", async (t) => {
  withRestoredFetch(t);
  mockFetchReturning([eventRow()]);

  const event = await fetchEventBySlug("target-event");

  assert.equal(event.slug, "target-event");
  assert.equal(event.title, "Target event");
  assert.equal(event.developerOrOperator, "Waymo LLC");
  assert.deepEqual(event.location, { text: "Phoenix, AZ", countryCode: "US", precision: "city" });
  assert.deepEqual(event.systemVersion, { value: "5.0", knowledge: "stated" });
  assert.equal(event.sources.length, 1);
  assert.equal(event.sources[0].url, CANONICAL_URL);
  assert.equal(event.sources[0].type, "regulatory-record");
  assert.equal(event.sources[0].publisher, "NHTSA");
});

test("returns null when no public event matches the slug (maybeSingle, not an error)", async (t) => {
  withRestoredFetch(t);
  mockFetchReturning([]);

  const event = await fetchEventBySlug("does-not-exist");

  assert.equal(event, null);
});

test("still rejects a source_type outside the controlled vocabulary for a singly-fetched event", async (t) => {
  withRestoredFetch(t);
  mockFetchReturning([
    eventRow({ sources: [{ ...eventRow().sources[0], source_type: "not-a-real-type" }] }),
  ]);

  await assert.rejects(
    () => fetchEventBySlug("target-event"),
    /source\.source_type" has unexpected value/,
  );
});

test("still rejects observed_facts=[] for a curated event fetched singly (per-event invariant preserved)", async (t) => {
  withRestoredFetch(t);
  mockFetchReturning([eventRow({ origin: "curated", observed_facts: [] })]);

  await assert.rejects(
    () => fetchEventBySlug("target-event"),
    /"observed_facts" must be a non-empty array/,
  );
});

test("still accepts a source-derived event with no observed_facts/summary/review_status, fetched singly", async (t) => {
  withRestoredFetch(t);
  mockFetchReturning([
    eventRow({ origin: "source-derived", observed_facts: [], summary: null, review_status: null }),
  ]);

  const event = await fetchEventBySlug("target-event");

  assert.equal(event.origin, "source-derived");
  assert.deepEqual(event.observedFacts, []);
  assert.equal(event.summary, null);
  assert.equal(event.reviewStatus, null);
});

test("still rejects a fetched event with no sources (per-event invariant preserved)", async (t) => {
  withRestoredFetch(t);
  mockFetchReturning([eventRow({ sources: [] })]);

  await assert.rejects(
    () => fetchEventBySlug("target-event"),
    /no sources returned from the database/,
  );
});

test("propagates a PostgREST error instead of returning a misleading null", async (t) => {
  withRestoredFetch(t);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "simulated failure", code: "PGRST000" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

  await assert.rejects(
    () => fetchEventBySlug("target-event"),
    /Failed to load event "target-event" from Supabase \(PGRST000\)/,
  );
});

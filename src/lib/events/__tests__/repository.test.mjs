/**
 * Regression coverage for Observatory pagination (getEventsPageData), tested
 * through the real exported API against a mocked fetch — same technique as
 * supabase-source.test.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

const { getEventsPageData, OBSERVATORY_PAGE_SIZE } = await import("../repository.ts");

const CANONICAL_URL =
  "https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting";

function eventRow(n, overrides = {}) {
  return {
    slug: `event-${String(n).padStart(4, "0")}`,
    title: `Event ${n}`,
    summary: "Test summary.",
    occurred_on: "2024-01-01",
    occurred_on_precision: "day",
    location_text: null,
    location_country_code: null,
    location_precision: "unknown",
    developer_or_operator: "Waymo LLC",
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
        source_type: "regulatory-record",
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

function withMockedFetch(t, rows) {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  mockFetchReturning(rows);
}

test("OBSERVATORY_PAGE_SIZE is 50", () => {
  assert.equal(OBSERVATORY_PAGE_SIZE, 50);
});

test("page 1 of an unfiltered 120-event corpus returns exactly 50 events, page 1 of 3", async (t) => {
  withMockedFetch(t, Array.from({ length: 120 }, (_, i) => eventRow(i)));
  const data = await getEventsPageData({});
  assert.equal(data.events.length, 50);
  assert.equal(data.matchedCount, 120);
  assert.equal(data.page, 1);
  assert.equal(data.totalPages, 3);
});

test("page 2 returns the next 50, page 3 (final) returns the remaining 20, with no overlap or gaps", async (t) => {
  withMockedFetch(t, Array.from({ length: 120 }, (_, i) => eventRow(i)));

  const page1 = await getEventsPageData({ page: "1" });
  const page2 = await getEventsPageData({ page: "2" });
  const page3 = await getEventsPageData({ page: "3" });

  assert.equal(page1.events.length, 50);
  assert.equal(page2.events.length, 50);
  assert.equal(page3.events.length, 20);

  const allSlugs = [...page1.events, ...page2.events, ...page3.events].map((e) => e.slug);
  assert.equal(new Set(allSlugs).size, 120, "all 120 slugs must be covered exactly once across the 3 pages");
});

for (const [label, rawPage] of [
  ["missing", undefined],
  ["zero", "0"],
  ["negative", "-1"],
  ["non-numeric", "abc"],
  ["non-integer", "1.5"],
]) {
  test(`page=${label} resolves safely to page 1`, async (t) => {
    withMockedFetch(t, Array.from({ length: 120 }, (_, i) => eventRow(i)));
    const searchParams = rawPage === undefined ? {} : { page: rawPage };
    const data = await getEventsPageData(searchParams);
    assert.equal(data.page, 1);
    assert.equal(data.events.length, 50);
  });
}

test("a page beyond the final page clamps to the final valid page rather than rendering empty", async (t) => {
  withMockedFetch(t, Array.from({ length: 120 }, (_, i) => eventRow(i)));
  const data = await getEventsPageData({ page: "999" });
  assert.equal(data.totalPages, 3);
  assert.equal(data.page, 3);
  assert.equal(data.events.length, 20);
});

test("zero matching events still yields a valid page 1 of 1, with an empty events array", async (t) => {
  withMockedFetch(t, [eventRow(0, { event_type: "collision" })]);
  const data = await getEventsPageData({ eventType: "other" });
  assert.equal(data.matchedCount, 0);
  assert.equal(data.totalPages, 1);
  assert.equal(data.page, 1);
  assert.deepEqual(data.events, []);
});

test("a canonical developerOrOperator filter still works together with pagination", async (t) => {
  // "Waymo", "Waymo LLC", "WAYMO LLC" are the same canonical operator
  // (see developer-operator.ts) — 60 rows split across the raw variants
  // should all be matched by filtering on the canonical "Waymo".
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => eventRow(i, { developer_or_operator: "Waymo" })),
    ...Array.from({ length: 20 }, (_, i) => eventRow(20 + i, { developer_or_operator: "Waymo LLC" })),
    ...Array.from({ length: 20 }, (_, i) => eventRow(40 + i, { developer_or_operator: "WAYMO LLC" })),
    eventRow(60, { developer_or_operator: "Tesla Inc" }),
  ];
  withMockedFetch(t, rows);

  const page1 = await getEventsPageData({ developerOrOperator: "Waymo", page: "1" });
  const page2 = await getEventsPageData({ developerOrOperator: "Waymo", page: "2" });

  assert.equal(page1.matchedCount, 60);
  assert.equal(page1.totalPages, 2);
  assert.equal(page1.events.length, 50);
  assert.equal(page2.events.length, 10);
  assert.ok(page1.events.every((e) => e.developerOrOperator !== "Tesla Inc"));
});

test("changing the filter naturally changes matchedCount/totalPages independent of any prior page state", async (t) => {
  const rows = [
    ...Array.from({ length: 100 }, (_, i) => eventRow(i, { event_type: "collision" })),
    ...Array.from({ length: 3 }, (_, i) => eventRow(100 + i, { event_type: "other" })),
  ];
  withMockedFetch(t, rows);

  const collisionData = await getEventsPageData({ eventType: "collision" });
  const otherData = await getEventsPageData({ eventType: "other" });

  assert.equal(collisionData.matchedCount, 100);
  assert.equal(collisionData.totalPages, 2);
  assert.equal(otherData.matchedCount, 3);
  assert.equal(otherData.totalPages, 1);
});

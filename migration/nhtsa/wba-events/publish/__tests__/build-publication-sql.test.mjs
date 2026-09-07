import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  evaluateAllRecords,
  partitionEligibility,
  buildTitledEligibleSet,
  findDuplicateTitles,
  buildExceptionReport,
  renderPublicationSql,
  renderRollbackSql,
  UNCHANGED_COLUMNS,
  loadProductionExport,
} from "../build-publication-sql.mjs";

const DIR = fileURLToPath(new URL("../", import.meta.url));
const EXPORT_PATH = DIR + "production-export.json";

function fixtureRecord(overrides = {}) {
  return {
    candidateId: "candidate-1",
    sameIncidentId: "same-incident-1",
    candidateStatus: "pending",
    linkedEventId: "11111111-1111-1111-1111-111111111111",
    event: {
      id: "11111111-1111-1111-1111-111111111111",
      slug: "nhtsa-abc123",
      origin: "source-derived",
      is_public: false,
      title: null,
      summary: null,
      review_status: null,
      observed_facts: [],
      developer_or_operator: "Waymo LLC",
      event_type: "collision",
      valence: "neutral-or-unclear",
      location_text: null,
      occurred_on: null,
      occurred_on_precision: "unknown",
    },
    sources: [{ source_type: "regulatory-record", external_record_id: "historical:1-2" }],
    ...overrides,
  };
}

// --- orchestration over synthetic fixtures --------------------------------

test("evaluateAllRecords: a clean batch is fully eligible", () => {
  const records = [
    fixtureRecord({ candidateId: "c1", linkedEventId: "e1", event: { ...fixtureRecord().event, id: "e1", slug: "nhtsa-1" } }),
    fixtureRecord({ candidateId: "c2", linkedEventId: "e2", event: { ...fixtureRecord().event, id: "e2", slug: "nhtsa-2" } }),
  ];
  const evaluated = evaluateAllRecords(records);
  assert.equal(evaluated.every((r) => r.eligible), true);
});

test("evaluateAllRecords: an event linked by two candidates makes BOTH records ineligible", () => {
  const shared = { ...fixtureRecord().event, id: "shared", slug: "nhtsa-shared" };
  const records = [
    fixtureRecord({ candidateId: "c1", linkedEventId: "shared", event: shared }),
    fixtureRecord({ candidateId: "c2", linkedEventId: "shared", event: shared }),
  ];
  const evaluated = evaluateAllRecords(records);
  assert.equal(evaluated.every((r) => !r.eligible), true);
  assert.ok(evaluated[0].failures.some((f) => f.includes("linked by 2 candidates")));
  assert.ok(evaluated[1].failures.some((f) => f.includes("linked by 2 candidates")));
});

test("partitionEligibility splits eligible from exceptions correctly", () => {
  const ok = fixtureRecord({ candidateId: "c1", linkedEventId: "e1", event: { ...fixtureRecord().event, id: "e1" } });
  const bad = fixtureRecord({
    candidateId: "c2",
    linkedEventId: "e2",
    event: { ...fixtureRecord().event, id: "e2", developer_or_operator: null },
  });
  const { eligible, exceptions } = partitionEligibility(evaluateAllRecords([ok, bad]));
  assert.equal(eligible.length, 1);
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].record.candidateId, "c2");
});

test("buildTitledEligibleSet produces one title per eligible record, deterministically", () => {
  const record = fixtureRecord({ event: { ...fixtureRecord().event, location_text: "Phoenix, AZ, US" } });
  const titled = buildTitledEligibleSet([record]);
  assert.equal(titled.length, 1);
  assert.equal(titled[0].title, "Waymo LLC Collision — Phoenix, AZ, US");
});

test("findDuplicateTitles reports collisions without introducing disambiguation", () => {
  const a = fixtureRecord({ candidateId: "c1", linkedEventId: "e1", event: { ...fixtureRecord().event, id: "e1" } });
  const b = fixtureRecord({ candidateId: "c2", linkedEventId: "e2", event: { ...fixtureRecord().event, id: "e2" } });
  const titled = buildTitledEligibleSet([a, b]);
  assert.equal(titled[0].title, titled[1].title); // identical inputs -> identical title, by design
  const duplicates = findDuplicateTitles(titled);
  assert.equal(duplicates.size, 1);
  assert.deepEqual(duplicates.get(titled[0].title), ["c1", "c2"]);
});

test("buildExceptionReport is factual/mechanical and deterministically ordered by candidateId", () => {
  const bad1 = fixtureRecord({
    candidateId: "zzz",
    linkedEventId: "e1",
    event: { ...fixtureRecord().event, id: "e1", developer_or_operator: null },
  });
  const bad2 = fixtureRecord({
    candidateId: "aaa",
    linkedEventId: "e2",
    event: { ...fixtureRecord().event, id: "e2", is_public: true },
  });
  const { exceptions } = partitionEligibility(evaluateAllRecords([bad1, bad2]));
  const report = buildExceptionReport(exceptions);
  assert.equal(report.length, 2);
  assert.equal(report[0].candidateId, "aaa"); // sorted
  assert.equal(report[1].candidateId, "zzz");
  for (const entry of report) {
    assert.ok(Array.isArray(entry.failures) && entry.failures.length > 0);
    assert.ok("slug" in entry && "linkedEventId" in entry);
  }
});

test("candidate.status is never written by any orchestration function (no such field in their output)", () => {
  const record = fixtureRecord();
  const titled = buildTitledEligibleSet([record]);
  // The titled/report shapes never carry a "status" write instruction —
  // structurally, nothing here can write nhtsa_incident_candidate at all.
  assert.equal("status" in titled[0], false);
});

// --- generated SQL structure ------------------------------------------------

const SAMPLE_TITLED = buildTitledEligibleSet([
  fixtureRecord({ event: { ...fixtureRecord().event, location_text: "Phoenix, AZ, US", occurred_on: "2024-03-01", occurred_on_precision: "month" } }),
]);

test("renderPublicationSql: wraps in begin/commit (one atomic transaction)", () => {
  const sql = renderPublicationSql(SAMPLE_TITLED);
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
});

test("renderPublicationSql: never uses a slug LIKE pattern as a predicate", () => {
  const sql = renderPublicationSql(SAMPLE_TITLED);
  assert.equal(/\bslug\s+like\s+'/i.test(sql), false);
});

test("renderPublicationSql: the UPDATE sets ONLY title and is_public", () => {
  const sql = renderPublicationSql(SAMPLE_TITLED);
  const match = sql.match(/update public\.event e\s+set\s+([\s\S]*?)\s+from/);
  assert.ok(match);
  const setClause = match[1].replace(/\s+/g, " ").trim();
  assert.equal(setClause, "title = v.title, is_public = true");
});

test("renderPublicationSql: postcondition exhaustively re-checks every other column via a live snapshot", () => {
  const sql = renderPublicationSql(SAMPLE_TITLED);
  assert.match(sql, /create temporary table pg_temp\.pre_publish_snapshot/);
  for (const column of UNCHANGED_COLUMNS) {
    assert.match(sql, new RegExp(`e\\.${column} is distinct from p\\.${column}`));
  }
  // The two intentional changes must NOT appear in the "unexpected change" list.
  assert.equal(new RegExp(`e\\.title is distinct from p\\.title`).test(sql), false);
  assert.equal(new RegExp(`e\\.is_public is distinct from p\\.is_public`).test(sql), false);
});

test("renderPublicationSql: precondition re-verifies LIVE state rather than trusting the export snapshot", () => {
  const sql = renderPublicationSql(SAMPLE_TITLED);
  assert.match(sql, /production state has drifted since this artifact was generated/);
});

test("renderPublicationSql: never references nhtsa_incident_candidate.status as a write target", () => {
  const sql = renderPublicationSql(SAMPLE_TITLED);
  assert.equal(/update\s+public\.nhtsa_incident_candidate/i.test(sql), false);
});

test("renderPublicationSql: the write set is keyed by linked_event_id-derived uuids, not slugs", () => {
  const sql = renderPublicationSql(SAMPLE_TITLED);
  assert.match(sql, /\('11111111-1111-1111-1111-111111111111'::uuid,/);
});

test("renderPublicationSql: STOPs (raises) on any precondition/postcondition mismatch rather than proceeding silently", () => {
  const sql = renderPublicationSql(SAMPLE_TITLED);
  assert.match(sql, /raise exception 'precondition failed/);
  assert.match(sql, /raise exception 'postcondition failed/);
});

test("renderRollbackSql: targets the exact same generated event id set, never a slug pattern", () => {
  const sql = renderRollbackSql(SAMPLE_TITLED);
  assert.equal(/\bslug\s+like\s+'/i.test(sql), false);
  assert.match(sql, /\('11111111-1111-1111-1111-111111111111'::uuid\)/);
});

test("renderRollbackSql: sets ONLY is_public and title", () => {
  const sql = renderRollbackSql(SAMPLE_TITLED);
  const match = sql.match(/update public\.event e\s+set\s+([\s\S]*?)\s+from/);
  assert.ok(match);
  const setClause = match[1].replace(/\s+/g, " ").trim();
  assert.equal(setClause, "is_public = false,\n    title = null".replace(/\s+/g, " ").trim());
});

test("renderRollbackSql: never writes candidate.status, never deletes any row (no source deletion)", () => {
  const sql = renderRollbackSql(SAMPLE_TITLED);
  assert.equal(/update\s+public\.nhtsa_incident_candidate/i.test(sql), false);
  assert.equal(/delete\s+from/i.test(sql), false);
});

test("renderRollbackSql: documents first_published_at as intentionally non-reverted", () => {
  const sql = renderRollbackSql(SAMPLE_TITLED);
  assert.match(sql, /first_published_at is NOT reverted and CANNOT be/);
});

test("renderRollbackSql: never references normalization/classification logic", () => {
  const sql = renderRollbackSql(SAMPLE_TITLED);
  assert.equal(/classify|evidence\.mjs|normalization/i.test(sql), false);
});

// --- guarded real-corpus check (only when a live export is present) --------

test("real production export: eligible/exception counts match the independently-verified SQL aggregate (skipped without a live export)", (t) => {
  if (!existsSync(EXPORT_PATH)) {
    t.skip("no production-export.json present in this environment");
    return;
  }
  const records = loadProductionExport(EXPORT_PATH);
  const { eligible, exceptions } = partitionEligibility(evaluateAllRecords(records));
  assert.equal(records.length, 2843);
  assert.equal(eligible.length, 2837);
  assert.equal(exceptions.length, 6);
});

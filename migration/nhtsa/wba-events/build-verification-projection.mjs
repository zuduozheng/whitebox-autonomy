/**
 * Canonical verification projection + expected hash.
 *
 * PROBLEM: comparing a raw production export against
 * wba-events-dry-run.jsonl's SHA-256 (754d7133...) byte-for-byte would
 * always fail even for a perfect promotion, because production
 * intentionally differs in ways that carry no information: DB-generated
 * UUIDs, DB timestamps (created_at/updated_at), the canonical URL replacing
 * the dry run's `url: null`, and row ordering (SQL has no guaranteed order).
 *
 * SOLUTION: project every record down to ONLY the deterministic, mapped
 * fields (excluding every DB-owned column), apply the one KNOWN, INTENTIONAL
 * substitution (url: null -> the canonical NHTSA URL), sort everything
 * deterministically (records by slug; each record's sources by
 * external_record_id), and hash the result. This script builds that
 * projection and hash from the LOCAL, approved dry-run artifact now. A
 * later, separate step (not run by this script, and not run by this task —
 * see its companion doc comment below) would build the SAME projection shape
 * from a real production export and compare hashes.
 *
 * Run: node migration/nhtsa/wba-events/build-verification-projection.mjs
 * Writes: wba-events-verification-projection.json, prints the expected hash.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { loadDryRunRecords, CANONICAL_NHTSA_URL } from "./build-promotion-sql.mjs";

const DIR = fileURLToPath(new URL("./", import.meta.url));
const PROJECTION_PATH = DIR + "wba-events-verification-projection.json";

/**
 * The exact, ordered set of `event` fields carried into this projection —
 * every field this promotion actually maps, and NOTHING DB-owned (no id,
 * created_at, updated_at, created_by, updated_by, first_published_at).
 */
const EVENT_PROJECTION_FIELDS = [
  "slug",
  "title",
  "summary",
  "occurred_on",
  "occurred_on_precision",
  "location_text",
  "location_country_code",
  "location_precision",
  "developer_or_operator",
  "system_name",
  "automation_status",
  "system_version",
  "system_version_knowledge",
  "event_type",
  "valence",
  "observed_facts",
  "unknowns",
  "interpretation",
  "causation_status",
  "causation_note",
  "scenario_tags",
  "review_status",
  "record_updated",
  "is_public",
];

/**
 * The exact, ordered set of `event_source` fields carried into this
 * projection — no id/event_id/created_at/updated_at/created_by/updated_by.
 */
const SOURCE_PROJECTION_FIELDS = [
  "url",
  "source_type",
  "external_record_id",
  "publisher",
  "label",
  "published_on",
  "published_on_precision",
  "retrieved_on",
  "note",
];

function pick(obj, fields) {
  const out = {};
  for (const f of fields) out[f] = obj[f] === undefined ? null : obj[f];
  return out;
}

/**
 * Project one dry-run record: DB-owned fields excluded by construction (they
 * were never present in the dry run to begin with), the one intentional
 * `url: null -> canonicalUrl` substitution applied, sources sorted by
 * external_record_id for order-independence.
 */
export function projectRecord(record, canonicalUrl = CANONICAL_NHTSA_URL) {
  const event = pick(record.event, EVENT_PROJECTION_FIELDS);
  const sources = record.eventSources
    .map((s) => pick({ ...s, url: canonicalUrl }, SOURCE_PROJECTION_FIELDS))
    .sort((a, b) => (a.external_record_id < b.external_record_id ? -1 : a.external_record_id > b.external_record_id ? 1 : 0));
  return { slug: event.slug, event, sources };
}

/** Build the full, deterministically-sorted projection for a batch of records. */
export function buildVerificationProjection(records, canonicalUrl = CANONICAL_NHTSA_URL) {
  return records
    .map((r) => projectRecord(r, canonicalUrl))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** Stable JSON serialization (fields already inserted in a fixed key order by `pick`). */
export function serializeProjection(projection) {
  return JSON.stringify(projection);
}

export function hashProjection(projection) {
  return createHash("sha256").update(serializeProjection(projection)).digest("hex");
}

function main() {
  const records = loadDryRunRecords();
  const projection = buildVerificationProjection(records);
  const serialized = serializeProjection(projection);
  const hash = hashProjection(projection);

  writeFileSync(
    PROJECTION_PATH,
    JSON.stringify(
      {
        recordCount: projection.length,
        sourceCount: projection.reduce((n, r) => n + r.sources.length, 0),
        canonicalUrl: CANONICAL_NHTSA_URL,
        expectedSha256: hash,
        projectionByteLength: serialized.length,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`Projected ${projection.length} records, ${projection.reduce((n, r) => n + r.sources.length, 0)} sources.`);
  console.log(`Expected verification SHA-256: ${hash}`);
  console.log(`Wrote ${PROJECTION_PATH}`);
  console.log("");
  console.log("To verify a REAL production promotion later (not run by this script/task), build the");
  console.log("same shape from production with a read-only query, e.g.:");
  console.log("");
  console.log("  select e.slug,");
  console.log("         jsonb_build_object('slug', e.slug, 'title', e.title, ... <same EVENT_PROJECTION_FIELDS order>) as event,");
  console.log("         (select jsonb_agg(jsonb_build_object('url', s.url, ... <same SOURCE_PROJECTION_FIELDS order>) order by s.external_record_id)");
  console.log("          from event_source s where s.event_id = e.id) as sources");
  console.log("  from event e where e.slug like 'nhtsa-%' order by e.slug;");
  console.log("");
  console.log("...then apply the exact same pick/sort/serialize/hash steps this script uses and compare");
  console.log("the resulting hash against expectedSha256 above.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

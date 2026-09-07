/**
 * Legacy-migration import builder — White Box Autonomy.
 *
 * Run:
 *   node migration/legacy/build-import.mjs            # dry-run (default): checks only, writes nothing
 *   node migration/legacy/build-import.mjs --print-sql # dry-run + dump the generated SQL to stdout
 *   node migration/legacy/build-import.mjs --emit      # write the three artifacts
 *
 * No dependencies. Imports migration/legacy/manifest.ts directly (Node strips
 * the type-only import at runtime), exactly like validate.mjs.
 *
 * WHAT IT DOES
 *   manifest.ts (decision === "import"; the canonical content source) is the
 *   ONLY input. This tool selects the 76 import records, generates a
 *   deterministic, frozen, human-readable slug for each, re-checks every
 *   `public.event` / `public.event_source` CHECK constraint in JS, and emits a
 *   reviewable SQL data script that follows the SAME draft -> sources -> publish
 *   lifecycle as supabase/seed.sql, wrapped in ONE transaction.
 *
 * WHAT IT DOES NOT DO
 *   No database access of any kind. It never connects to Supabase, never reads
 *   or writes any database, and is not imported by the application. Applying
 *   import.sql is a separate, manual, explicitly-approved step.
 *
 * ARTIFACTS (written only with --emit)
 *   migration/legacy/import.sql           the idempotent import (begin/commit)
 *   migration/legacy/import-rollback.sql  removes ONLY the 76 imported slugs
 *   migration/legacy/slug-map.json        frozen legacy_id -> slug provenance
 *
 * DETERMINISM
 *   Output is a pure function of manifest.ts. Re-running --emit with an
 *   unchanged manifest reproduces byte-identical files (no timestamps, no
 *   ordering nondeterminism). Once slug-map.json exists, a slug may never change
 *   for a legacy_id already listed there: the build fails loudly instead.
 *
 * The enum value sets below MUST stay in sync with src/lib/events/types.ts and
 * the CHECK constraints in supabase/migrations/20260829235332_observatory_core.sql.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LEGACY_MANIFEST, EXISTING_OBSERVATORY_EVENTS } from "./manifest.ts";

// ---------------------------------------------------------------------------
// Constants — approved migration decisions.
// ---------------------------------------------------------------------------

/** Editorial "record last reviewed / finalised" date for the whole batch. */
const RECORD_UPDATED = "2026-09-01";

/** Expected shape of the accepted set (guards against manifest drift). */
const EXPECT = {
  importRecords: 76,
  firstHandImports: 57,
  communityImports: 19,
  sourceRows: 78,
};

const DIR = fileURLToPath(new URL("./", import.meta.url));
const IMPORT_SQL_PATH = DIR + "import.sql";
const ROLLBACK_SQL_PATH = DIR + "import-rollback.sql";
const SLUG_MAP_PATH = DIR + "slug-map.json";

// ---------------------------------------------------------------------------
// Controlled vocabularies (byte-identical to the live model).
// ---------------------------------------------------------------------------
const EVENT_TYPES = new Set([
  "collision",
  "near-miss-or-safety-critical",
  "unexpected-or-inappropriate-behaviour",
  "unnecessary-stop-braking-or-hesitation",
  "traffic-rule-or-infrastructure-interpretation",
  "vulnerable-road-user-interaction",
  "emergency-vehicle-interaction",
  "traffic-disruption-or-obstruction",
  "successful-challenging-interaction",
  "other",
]);
const VALENCES = new Set([
  "failure-or-challenging",
  "successful-handling",
  "neutral-or-unclear",
]);
const AUTOMATION_STATUSES = new Set([
  "driving-automation-engaged-confirmed",
  "driving-automation-engaged-reported",
  "driving-automation-status-uncertain",
  "driving-automation-not-engaged",
  "unknown",
]);
const CAUSATION_STATUSES = new Set([
  "undetermined",
  "automation-system-contributed",
  "other-party-contributed",
  "shared-or-multiple-factors",
  "not-applicable",
]);
const SOURCE_TYPES = new Set([
  "x-post",
  "youtube-video",
  "news-article",
  "official-report",
  "other",
]);
const DATE_PRECISIONS = new Set(["day", "month", "year", "unknown"]);
const VERSION_KNOWLEDGE = new Set(["stated", "approximate", "unknown"]);

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const HTTP_RE = /^https?:\/\//;

// ---------------------------------------------------------------------------
// Slug generation — deterministic, order-independent, human-readable.
//
// Final policy (see the migration plan review):
//   * base slugification: strip a possessive 's ("FSD's" -> "fsd", not "fsds"),
//     drop other apostrophes, lower-case ASCII, hyphen-separate, then remove a
//     single leading "a-" / "an-" / "the-";
//   * full slug <= 80 chars -> keep it whole;
//   * full slug > 80 chars -> use the longest natural clause-boundary prefix of
//     the ORIGINAL title (delimiters ; : , en/em dash, or a sentence-ending
//     ".") whose slug is 24..80 chars; failing that, truncate at the last whole
//     word within 80 chars;
//   * SLUG_OVERRIDES wins outright for a handful of editorially-reviewed slugs.
// No function-word list, no article-fragment trimming.
// ---------------------------------------------------------------------------

/**
 * Editorially-reviewed permanent slugs. An entry here is authoritative: it is
 * used verbatim (still validated for regex / uniqueness / no clash with the
 * nine, and NEVER given a "-<legacy-id>" disambiguation suffix — an override
 * collision is surfaced as an error, not auto-mangled).
 */
const SLUG_OVERRIDES = {
  "FH-42": "fsd-completes-a-u-turn-with-a-wrong-turn-signal",
  "FH-44": "fsd-becomes-stuck-turning-left-onto-a-small-bridge",
  "FH-45": "fsd-moves-toward-oncoming-traffic-attempting-a-right-turn",
  "FH-48": "fsd-is-slow-to-reach-the-correct-lane-after-a-ramp-merge",
  "FH-57": "fsd-moves-into-a-dedicated-right-turn-lane",
  "FH-61": "fsd-slows-for-an-ibis-on-the-roadway",
};

const SLUG_MAX = 80;
const CLAUSE_MIN = 24;
const CLAUSE_DELIM_RE = /[;:,–—]/; // ; : , en-dash em-dash

/** Title -> bare slug candidate: ASCII, lower-case, hyphen-separated. */
function slugifyBase(title) {
  return String(title)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/([a-z0-9])['’`´]s\b/g, "$1") // possessive 's -> drop ("fsd's" -> "fsd")
    .replace(/['’`´]/g, "") // drop any remaining apostrophes
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^(?:a|an|the)-/, ""); // strip a single leading article
}

/** Truncate a slug to <= max chars on a hyphen boundary (never mid-word). */
function truncateOnWord(slug, max = SLUG_MAX) {
  if (slug.length <= max) return slug;
  let cut = slug.slice(0, max);
  const lastDash = cut.lastIndexOf("-");
  if (lastDash > 0) cut = cut.slice(0, lastDash);
  return cut.replace(/-+$/, "");
}

/**
 * Slug for one import title.
 *   { slug, method }  where method is "full" | "clause-cut" | "word-truncated".
 * Callers handle SLUG_OVERRIDES before this is reached.
 */
function slugForTitle(title) {
  const full = slugifyBase(title);
  if (full.length <= SLUG_MAX) return { slug: full, method: "full" };

  // Longest ORIGINAL-title prefix ending at a clause boundary whose slug fits.
  let best = null;
  for (let i = 1; i < title.length; i++) {
    const ch = title[i];
    const isBoundary =
      CLAUSE_DELIM_RE.test(ch) ||
      (ch === "." && (i + 1 >= title.length || /\s/.test(title[i + 1])));
    if (!isBoundary) continue;
    const cand = slugifyBase(title.slice(0, i));
    if (cand.length >= CLAUSE_MIN && cand.length <= SLUG_MAX && (!best || cand.length > best.length)) {
      best = cand;
    }
  }
  if (best) return { slug: best, method: "clause-cut" };

  return { slug: truncateOnWord(full), method: "word-truncated" };
}

/**
 * Compute the frozen slug for every import record.
 *
 * Two passes, so the result does not depend on manifest ordering:
 *   1. raw slug per record = SLUG_OVERRIDES[legacy_id] ?? slugForTitle(title);
 *   2. a NON-override raw slug that is shared by >1 record OR collides with one
 *      of the nine existing Observatory slugs is disambiguated for ALL of its
 *      holders by appending "-<legacy-id>" (permanently unique + stable).
 *      Override slugs are never suffixed.
 */
function computeSlugs(imports, existingSlugs) {
  const existing = new Set(existingSlugs);

  const raw = imports.map((r) => {
    if (r.legacy_id in SLUG_OVERRIDES) {
      return { legacy_id: r.legacy_id, slug: SLUG_OVERRIDES[r.legacy_id], method: "override" };
    }
    const { slug, method } = slugForTitle(r.proposed_title);
    return { legacy_id: r.legacy_id, slug, method };
  });

  const counts = new Map();
  for (const x of raw) counts.set(x.slug, (counts.get(x.slug) ?? 0) + 1);

  return raw.map((x) => {
    if (x.method === "override") return x;
    const contested = counts.get(x.slug) > 1 || existing.has(x.slug);
    return contested
      ? { ...x, slug: `${x.slug}-${x.legacy_id.toLowerCase()}`, method: `${x.method}+disambiguated` }
      : x;
  });
}

// ---------------------------------------------------------------------------
// Mapping validation — mirrors every CHECK constraint on the two tables, so a
// clean build can never be rejected by the database for a content reason.
// ---------------------------------------------------------------------------

function nonBlank(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function validateEvent(rec, slug, errors) {
  const id = rec.legacy_id;
  const bad = (m) => errors.push(`${id}: ${m}`);

  if (!SLUG_RE.test(slug)) bad(`generated slug "${slug}" fails ${SLUG_RE}`);

  if (!nonBlank(rec.proposed_title)) bad("proposed_title is blank");
  if (!nonBlank(rec.summary)) bad("summary is blank");

  const date = rec.event_date ?? null;
  const prec = rec.event_date_precision;
  if (!DATE_PRECISIONS.has(prec)) bad(`invalid event_date_precision ${JSON.stringify(prec)}`);
  if ((date === null) !== (prec === "unknown")) {
    bad(`event_date (${JSON.stringify(date)}) and precision (${prec}) disagree — null date <=> "unknown"`);
  }
  if (date !== null && !ISO_DATE_RE.test(date)) bad(`event_date not ISO YYYY-MM-DD (${date})`);

  if (rec.location_text != null && !nonBlank(rec.location_text)) bad("location_text present but blank");
  if (rec.location_country_code != null && !COUNTRY_RE.test(rec.location_country_code)) {
    bad(`location_country_code not ISO alpha-2 (${rec.location_country_code})`);
  }

  if (!nonBlank(rec.developer_or_operator)) bad("developer_or_operator is blank");
  if (rec.system_name != null && !nonBlank(rec.system_name)) bad("system_name present but blank");

  if (!AUTOMATION_STATUSES.has(rec.automation_status)) {
    bad(`invalid automation_status ${JSON.stringify(rec.automation_status)}`);
  }

  const sv = rec.system_version ?? null;
  const svk = rec.system_version_knowledge ?? "unknown";
  if (!VERSION_KNOWLEDGE.has(svk)) bad(`invalid system_version_knowledge ${JSON.stringify(svk)}`);
  if (sv != null && !nonBlank(sv)) bad("system_version present but blank");
  if (sv != null && svk === "unknown") {
    bad('system_version is set but system_version_knowledge is "unknown" (violates system_version_needs_knowledge)');
  }

  if (!EVENT_TYPES.has(rec.event_type)) bad(`invalid event_type ${JSON.stringify(rec.event_type)}`);
  if (!VALENCES.has(rec.valence)) bad(`invalid valence ${JSON.stringify(rec.valence)}`);

  for (const field of ["observable_evidence", "what_remains_unknown"]) {
    const arr = rec[field];
    if (!Array.isArray(arr) || arr.length < 1) {
      bad(`${field} must be a non-empty array`);
    } else if (arr.some((x) => !nonBlank(x))) {
      bad(`${field} contains a blank / non-string entry`);
    }
  }

  if (rec.interpretation != null && !nonBlank(rec.interpretation)) {
    bad("interpretation present but blank");
  }

  if (!CAUSATION_STATUSES.has(rec.causal_attribution)) {
    bad(`invalid causal_attribution ${JSON.stringify(rec.causal_attribution)}`);
  }

  if (rec.review_status !== "curator-reviewed") {
    bad(`review_status is ${JSON.stringify(rec.review_status)} (every import must stay "curator-reviewed")`);
  }
}

function validateSource(rec, src, idx, errors) {
  const id = `${rec.legacy_id} source[${idx}]`;
  const bad = (m) => errors.push(`${id}: ${m}`);

  if (typeof src.source_url !== "string" || !HTTP_RE.test(src.source_url)) {
    bad(`source_url not an http(s) URL (${src.source_url})`);
  }
  if (!SOURCE_TYPES.has(src.source_type)) bad(`invalid source_type ${JSON.stringify(src.source_type)}`);
  if (src.publisher_or_uploader != null && !nonBlank(src.publisher_or_uploader)) {
    bad("publisher_or_uploader present but blank");
  }
  if (src.note != null && !nonBlank(src.note)) bad("note present but blank");
}

// ---------------------------------------------------------------------------
// SQL generation.
// ---------------------------------------------------------------------------

/** Standard SQL string literal (single quotes doubled). null/undefined -> null. */
function sql(v) {
  if (v === null || v === undefined) return "null";
  const s = String(v);
  if (s.includes("\0")) throw new Error(`NUL byte in value: ${JSON.stringify(s)}`);
  return `'${s.replace(/'/g, "''")}'`;
}

/** text[] literal: array['a','b',...]. Never empty here (validated >= 1). */
function sqlTextArray(arr) {
  return `array[${arr.map(sql).join(", ")}]`;
}

const EVENT_COLUMNS = [
  "slug", "title", "summary", "occurred_on", "occurred_on_precision",
  "location_text", "location_country_code", "developer_or_operator", "system_name",
  "automation_status", "system_version", "system_version_knowledge",
  "event_type", "valence", "observed_facts", "unknowns", "interpretation",
  "causation_status", "causation_note", "review_status", "record_updated",
];

// SELECT list out of the CTE: every column carries an explicit type so the
// result is well-defined regardless of how NULLs are distributed across rows.
const EVENT_SELECT = [
  "slug", "title", "summary", "occurred_on::date", "occurred_on_precision",
  "location_text::text", "location_country_code::text", "developer_or_operator",
  "system_name::text", "automation_status", "system_version::text",
  "system_version_knowledge", "event_type", "valence",
  "observed_facts::text[]", "unknowns::text[]", "interpretation::text",
  "causation_status", "causation_note::text", "review_status", "record_updated::date",
];

const SOURCE_COLUMNS = [
  "event_slug", "url", "source_type", "publisher", "label",
  "published_on", "published_on_precision", "retrieved_on", "note",
];

function eventValuesRow(rec, slug) {
  const cells = [
    sql(slug),
    sql(rec.proposed_title),
    sql(rec.summary),
    sql(rec.event_date ?? null),
    sql(rec.event_date_precision),
    sql(rec.location_text ?? null),
    sql(rec.location_country_code ?? null),
    sql(rec.developer_or_operator),
    sql(rec.system_name ?? null),
    sql(rec.automation_status),
    sql(rec.system_version ?? null),
    sql(rec.system_version_knowledge ?? "unknown"),
    sql(rec.event_type),
    sql(rec.valence),
    sqlTextArray(rec.observable_evidence),
    sqlTextArray(rec.what_remains_unknown),
    sql(rec.interpretation ?? null),
    sql(rec.causal_attribution),
    sql(null), // causation_note — not carried by any import record
    sql(rec.review_status),
    sql(RECORD_UPDATED),
  ];
  return `  ( -- ${rec.legacy_id}\n    ${cells.join(",\n    ")}\n  )`;
}

function sourceValuesRow(rec, slug, src) {
  const cells = [
    sql(slug),
    sql(src.source_url),
    sql(src.source_type),
    sql(src.publisher_or_uploader ?? null),
    sql(null), // label — legacy sources carry no curator label
    sql(null), // published_on — no import source states one; never inferred from posting dates
    sql("unknown"), // published_on_precision
    sql(null), // retrieved_on — deliberately NULL (no import-date stamp)
    sql(src.note ?? null),
  ];
  return `  ( -- ${rec.legacy_id}\n    ${cells.join(",\n    ")}\n  )`;
}

function updateSetClause(columns, keyCols) {
  return columns
    .filter((c) => !keyCols.includes(c))
    .map((c) => `  ${c} = excluded.${c}`)
    .join(",\n");
}

function distinctGuard(table, columns, keyCols) {
  return columns
    .filter((c) => !keyCols.includes(c))
    .map((c) => `${table}.${c} is distinct from excluded.${c}`)
    .join("\n  or ");
}

function buildImportSql(rows) {
  const eventValues = rows.map((r) => eventValuesRow(r.rec, r.slug)).join(",\n");

  const sourceValues = rows
    .flatMap((r) => r.rec.sources.map((s) => sourceValuesRow(r.rec, r.slug, s)))
    .join(",\n");

  const publishList = rows.map((r) => `   ${sql(r.slug)}`).join(",\n");

  const eventSelectFromCte = EVENT_SELECT.map((c) => `  ${c}`).join(",\n");
  const sourceSelectCols = [
    "  e.id",
    "  s.url",
    "  s.source_type",
    "  s.publisher::text",
    "  s.label::text",
    "  s.published_on::date",
    "  s.published_on_precision",
    "  s.retrieved_on::date",
    "  s.note::text",
  ].join(",\n");

  return `-- White Box Autonomy — legacy-event migration import (76 accepted records).
--
-- GENERATED FILE. Source of truth: migration/legacy/manifest.ts
-- (records with decision === "import"). Regenerate with:
--
--     node migration/legacy/build-import.mjs --emit
--
-- Do not hand-edit. Editorial content is transcribed verbatim from the manifest;
-- conservative values (review_status, automation_status, causal_attribution,
-- event_type, valence, date precision, location text/country, system version and
-- its knowledge level) are preserved exactly. Missing information stays NULL /
-- 'unknown' and is never inferred. Fields with no column in the current schema
-- (location precision, per-record curator notes, legacy ids) are intentionally
-- NOT written here; they remain in the migration artifacts. See
-- migration/legacy/slug-map.json for the frozen legacy_id -> slug provenance.
--
-- WHAT THIS IS NOT
--   Not a schema migration. Editorial data, not DDL history — it lives here, not
--   in supabase/migrations/, and is never applied by \`supabase db push\`.
--
-- HOW TO RUN IT (against the linked hosted project — CLI login token via the
-- Management API; no database password or service-role key). Do NOT run this
-- until the plan's local/branch rehearsal has passed:
--
--     npx supabase db query --linked --file migration/legacy/import.sql
--
-- PUBLICATION PATH (identical to supabase/seed.sql)
--   Events are upserted as DRAFTS (is_public is never carried by the upsert),
--   then their sources are upserted, then a single final
--   \`UPDATE ... SET is_public = true\` publishes them. This is the one canonical
--   publication path the database enforces
--   (20260901000000_public_event_requires_source.sql): is_public only ever goes
--   not-true -> true via UPDATE, and only once >= 1 source exists.
--
-- IDEMPOTENCY
--   event      -> upsert on (slug); DO UPDATE guarded by IS DISTINCT FROM over
--                 every editorial column, so a no-op re-run performs zero writes.
--   event_source -> upsert on (event_id, url), same editorial guard.
--   publish    -> \`AND is_public IS NOT TRUE\`, so first_published_at is stamped
--                 exactly once and a re-run never republishes.
--   The 76 slugs below are disjoint from the nine pre-existing Observatory
--   events, so no unrelated row is ever touched. id / created_at / updated_at /
--   first_published_at / created_by / updated_by are all database-owned and are
--   never written here.
--
-- Records: ${rows.length} events, ${rows.reduce((n, r) => n + r.rec.sources.length, 0)} sources. record_updated = ${RECORD_UPDATED} for every event.

begin;

-- ---------------------------------------------------------------------------
-- events (upserted as drafts)
-- ---------------------------------------------------------------------------
with seed (
${EVENT_COLUMNS.map((c) => `  ${c}`).join(",\n")}
) as (
  values
${eventValues}
)
insert into event (
${EVENT_COLUMNS.map((c) => `  ${c}`).join(",\n")}
)
select
${eventSelectFromCte}
from seed
on conflict (slug) do update set
${updateSetClause(EVENT_COLUMNS, ["slug"])}
where
  ${distinctGuard("event", EVENT_COLUMNS, ["slug"])};

-- ---------------------------------------------------------------------------
-- event_source (joined to the parent event by slug)
-- ---------------------------------------------------------------------------
with seed_source (
${SOURCE_COLUMNS.map((c) => `  ${c}`).join(",\n")}
) as (
  values
${sourceValues}
)
insert into event_source (
  event_id,
  url,
  source_type,
  publisher,
  label,
  published_on,
  published_on_precision,
  retrieved_on,
  note
)
select
${sourceSelectCols}
from seed_source s
join event e on e.slug = s.event_slug
on conflict (event_id, url) do update set
${updateSetClause(SOURCE_COLUMNS, ["event_slug", "url"])}
where
  ${distinctGuard("event_source", SOURCE_COLUMNS, ["event_slug", "url"])};

-- ---------------------------------------------------------------------------
-- publish — the ONLY path to is_public = true. Runs after the sources exist,
-- so the database invariant "a public event has >= 1 source" holds. Idempotent:
-- once public the WHERE matches nothing and first_published_at is never
-- re-stamped.
-- ---------------------------------------------------------------------------
update event
   set is_public = true
 where slug in (
${publishList}
 )
   and is_public is not true;

commit;
`;
}

function buildRollbackSql(rows) {
  const slugList = rows.map((r) => `   ${sql(r.slug)}`).join(",\n");
  return `-- White Box Autonomy — legacy-event migration ROLLBACK.
--
-- GENERATED FILE. Regenerate with: node migration/legacy/build-import.mjs --emit
--
-- Removes ONLY the ${rows.length} events created by migration/legacy/import.sql, and
-- their event_source rows (via ON DELETE CASCADE). It references none of the
-- nine pre-existing Observatory events — their rows, sources, first_published_at
-- and audit columns are untouched.
--
-- The event_source_enforce_not_last trigger is cascade-safe: during the cascade
-- the parent event row is already gone from this transaction's view, so the
-- guard is skipped and the delete completes.
--
--     npx supabase db query --linked --file migration/legacy/import-rollback.sql
--
-- If a future policy ever grants event DELETE only to a role that must also
-- satisfy that trigger directly, run the belt-and-braces variant at the bottom
-- instead (unpublish -> delete sources -> delete events).

begin;

delete from event
 where slug in (
${slugList}
 );

commit;

-- ---------------------------------------------------------------------------
-- Belt-and-braces variant (leave commented unless the plain delete is blocked):
--
-- begin;
--   update event set is_public = false
--    where slug in ( <the ${rows.length} slugs above> ) and is_public is true;
--   delete from event_source
--    where event_id in (select id from event where slug in ( <the ${rows.length} slugs> ));
--   delete from event
--    where slug in ( <the ${rows.length} slugs> );
-- commit;
`;
}

// ---------------------------------------------------------------------------
// Frozen slug-map: once a legacy_id is published, its slug can never change.
// ---------------------------------------------------------------------------

function buildSlugMap(slugPairs) {
  const slugs = {};
  for (const { legacy_id, slug } of slugPairs) slugs[legacy_id] = slug;
  return {
    _comment:
      "Frozen legacy_id -> published slug mapping. Canonical content source: " +
      'migration/legacy/manifest.ts (decision === "import"). Generated by ' +
      "migration/legacy/build-import.mjs --emit. Do not hand-edit. A slug here " +
      "must never change once its event has been published.",
    count: slugPairs.length,
    slugs,
  };
}

/**
 * Compare the slugs about to be written against the committed slug-map.json.
 *
 * A changed or dropped slug for an already-listed legacy_id is FATAL for a
 * normal run — a published slug is immutable. `regenerate` (the operator having
 * passed --regenerate-slug-map) turns that into a loud, non-fatal, one-time
 * pre-publication reset; the frozen-map protection is unchanged for every run
 * without the flag.
 *
 * Returns { status, changes: [{legacy_id, from, to}], fatal }.
 */
function checkFrozen(slugPairs, { regenerate }) {
  if (!existsSync(SLUG_MAP_PATH)) {
    return { status: "no existing slug-map.json — this run establishes it", changes: [], fatal: false };
  }
  let prev;
  try {
    prev = JSON.parse(readFileSync(SLUG_MAP_PATH, "utf8"));
  } catch (e) {
    return {
      status: `slug-map.json exists but is not valid JSON: ${e.message}`,
      changes: [],
      fatal: true,
    };
  }
  const prevSlugs = (prev && prev.slugs) || {};
  const now = new Map(slugPairs.map((p) => [p.legacy_id, p.slug]));

  const changes = [];
  for (const [legacyId, oldSlug] of Object.entries(prevSlugs)) {
    const newSlug = now.get(legacyId);
    if (newSlug === undefined) changes.push({ legacy_id: legacyId, from: oldSlug, to: "(no longer an import record)" });
    else if (newSlug !== oldSlug) changes.push({ legacy_id: legacyId, from: oldSlug, to: newSlug });
  }
  const added = slugPairs.filter((p) => !(p.legacy_id in prevSlugs)).length;

  let status;
  if (changes.length === 0) {
    status = `matches existing slug-map.json${added ? ` (+${added} new record(s))` : ""}`;
  } else if (regenerate) {
    status = `${changes.length} slug(s) change — one-time regeneration AUTHORISED (--regenerate-slug-map)`;
  } else {
    status = `${changes.length} frozen slug(s) would change — BLOCKED (pass --regenerate-slug-map for a one-time pre-publication reset)`;
  }
  return { status, changes, fatal: changes.length > 0 && !regenerate };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function main() {
  const args = new Set(process.argv.slice(2));
  const emit = args.has("--emit");
  const printSql = args.has("--print-sql");
  const printSlugs = args.has("--print-slugs");
  const regenSlugMap = args.has("--regenerate-slug-map");
  const mode = emit ? "EMIT" : "dry-run";

  const errors = [];
  const notes = [];

  const imports = LEGACY_MANIFEST.filter((r) => r.decision === "import");
  const fhImports = imports.filter((r) => r.legacy_collection === "first-hand");
  const crImports = imports.filter((r) => r.legacy_collection === "community");

  // --- checksums ---------------------------------------------------------
  if (imports.length !== EXPECT.importRecords) {
    errors.push(`expected ${EXPECT.importRecords} import records, found ${imports.length}`);
  }
  if (fhImports.length !== EXPECT.firstHandImports) {
    errors.push(`expected ${EXPECT.firstHandImports} first-hand imports, found ${fhImports.length}`);
  }
  if (crImports.length !== EXPECT.communityImports) {
    errors.push(`expected ${EXPECT.communityImports} community imports, found ${crImports.length}`);
  }

  // --- slugs -----------------------------------------------------------
  const existingSlugs = EXISTING_OBSERVATORY_EVENTS.map((e) => e.slug);
  const slugPairs = computeSlugs(imports, existingSlugs);
  const slugById = new Map(slugPairs.map((p) => [p.legacy_id, p.slug]));

  const seenSlug = new Map();
  for (const { legacy_id, slug } of slugPairs) {
    if (!SLUG_RE.test(slug)) errors.push(`${legacy_id}: slug "${slug}" fails ${SLUG_RE}`);
    if (existingSlugs.includes(slug)) {
      errors.push(`${legacy_id}: slug "${slug}" collides with an existing Observatory event`);
    }
    if (slug.length > SLUG_MAX) {
      errors.push(`${legacy_id}: slug "${slug}" is ${slug.length} chars (> ${SLUG_MAX})`);
    }
    if (seenSlug.has(slug)) {
      errors.push(`slug "${slug}" generated for both ${seenSlug.get(slug)} and ${legacy_id}`);
    } else {
      seenSlug.set(slug, legacy_id);
    }
  }

  // Every SLUG_OVERRIDES key must be a real import record.
  const importIds = new Set(imports.map((r) => r.legacy_id));
  for (const id of Object.keys(SLUG_OVERRIDES)) {
    if (!importIds.has(id)) errors.push(`SLUG_OVERRIDES has ${id} but it is not a decision="import" record`);
  }

  const frozen = checkFrozen(slugPairs, { regenerate: regenSlugMap });
  if (frozen.fatal) {
    for (const c of frozen.changes) {
      errors.push(
        `frozen slug for ${c.legacy_id} would change: "${c.from}" -> "${c.to}" — ` +
          `pass --regenerate-slug-map for a one-time pre-publication reset`,
      );
    }
  }

  const methodCount = {};
  for (const p of slugPairs) methodCount[p.method] = (methodCount[p.method] ?? 0) + 1;

  // --- per-record mapping + source validation --------------------------
  let sourceCount = 0;
  const mediaIds = new Map();
  const multiSource = [];
  const dupFlags = [];

  for (const rec of imports) {
    const slug = slugById.get(rec.legacy_id);
    validateEvent(rec, slug, errors);

    if (!Array.isArray(rec.sources) || rec.sources.length < 1) {
      errors.push(`${rec.legacy_id}: import record has no sources`);
      continue;
    }
    if (rec.sources.length > 1) multiSource.push(`${rec.legacy_id}(${rec.sources.length})`);

    rec.sources.forEach((src, i) => {
      sourceCount++;
      validateSource(rec, src, i, errors);
      if (src.canonical_media_id) {
        const prev = mediaIds.get(src.canonical_media_id);
        if (prev) {
          errors.push(`canonical_media_id ${src.canonical_media_id} appears in ${prev} and ${rec.legacy_id}`);
        } else {
          mediaIds.set(src.canonical_media_id, rec.legacy_id);
        }
      }
    });

    if (rec.duplicate_status === "possible-duplicate-review") {
      dupFlags.push(`${rec.legacy_id} -> ${slug}  (similar to: ${rec.duplicate_of})`);
    }
  }

  if (sourceCount !== EXPECT.sourceRows) {
    errors.push(`expected ${EXPECT.sourceRows} source rows, found ${sourceCount}`);
  }

  // --- automation-status distribution (report only) -------------------
  const autoDist = {};
  for (const r of imports) autoDist[r.automation_status] = (autoDist[r.automation_status] ?? 0) + 1;

  // --- report --------------------------------------------------------
  const line = "-".repeat(70);
  console.log(line);
  console.log(`LEGACY IMPORT BUILDER — ${mode}`);
  console.log(line);
  console.log(`import records ............ ${imports.length}  (first-hand ${fhImports.length}, community ${crImports.length})`);
  console.log(`event_source rows ........ ${sourceCount}  (multi-source: ${multiSource.join(", ") || "none"})`);
  console.log(`generated slugs .......... ${seenSlug.size} unique  max ${Math.max(...slugPairs.map((p) => p.slug.length))} chars`);
  console.log(`  by method .............. ${JSON.stringify(methodCount)}`);
  console.log(`  overrides .............. ${Object.keys(SLUG_OVERRIDES).length} (${Object.keys(SLUG_OVERRIDES).join(", ")})`);
  console.log(`slug collisions w/ the 9 . ${slugPairs.filter((p) => existingSlugs.includes(p.slug)).length}`);
  console.log(`frozen slug-map .......... ${frozen.status}`);
  for (const c of frozen.changes) {
    console.log(`    ${c.legacy_id}: ${c.from}`);
    console.log(`    ${" ".repeat(c.legacy_id.length)}  -> ${c.to}`);
  }
  console.log(`record_updated ........... ${RECORD_UPDATED} (all ${imports.length})`);
  console.log(`automation_status ........ ${JSON.stringify(autoDist)}`);
  console.log(`possible-duplicate flags . ${dupFlags.length} (informational — not blocking)`);
  for (const d of dupFlags) console.log(`    ${d}`);
  console.log(line);

  if (printSlugs) {
    console.log("legacy_id -> slug (method):");
    for (const p of slugPairs) {
      console.log(`  ${p.legacy_id.padEnd(6)} ${p.slug.padEnd(80)}  ${p.method}`);
    }
    console.log(line);
  }

  for (const n of notes) console.log(`NOTE: ${n}`);

  if (errors.length) {
    for (const e of errors) console.log(`FAIL: ${e}`);
    console.log(line);
    console.log(`BUILD FAILED — ${errors.length} error(s). Nothing written.`);
    process.exit(1);
  }

  const rows = imports.map((rec) => ({ rec, slug: slugById.get(rec.legacy_id) }));
  const importSql = buildImportSql(rows);
  const rollbackSql = buildRollbackSql(rows);
  const slugMap = JSON.stringify(buildSlugMap(slugPairs), null, 2) + "\n";

  if (printSql) {
    console.log(importSql);
    console.log(line);
  }

  if (!emit) {
    console.log("DRY RUN — no files written.");
    console.log("Re-run with --emit to write:");
    console.log("  migration/legacy/import.sql");
    console.log("  migration/legacy/import-rollback.sql");
    console.log("  migration/legacy/slug-map.json");
    console.log("Flags: --print-slugs (full mapping)  --print-sql (generated SQL)");
    console.log("       --regenerate-slug-map (one-time pre-publication slug reset)");
    return;
  }

  writeFileSync(IMPORT_SQL_PATH, importSql);
  writeFileSync(ROLLBACK_SQL_PATH, rollbackSql);
  writeFileSync(SLUG_MAP_PATH, slugMap);
  console.log("WROTE:");
  console.log(`  ${IMPORT_SQL_PATH}`);
  console.log(`  ${ROLLBACK_SQL_PATH}`);
  console.log(`  ${SLUG_MAP_PATH}`);
  console.log(line);
  console.log("Review the diff. Do NOT apply to the linked database yet.");
}

main();

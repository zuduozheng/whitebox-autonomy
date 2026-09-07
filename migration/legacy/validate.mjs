/**
 * Legacy-migration manifest validator — White Box Autonomy.
 *
 * Run:  node migration/legacy/validate.mjs
 *
 * No dependencies. Imports migration/legacy/manifest.ts directly (Node strips
 * the type-only import at runtime). Exits non-zero if any check fails.
 *
 * The enum value sets below MUST stay in sync with src/lib/events/types.ts.
 * The manifest itself is additionally type-checked against those types by
 * `next build` / `tsc`.
 */

import { LEGACY_MANIFEST, EXISTING_OBSERVATORY_EVENTS } from "./manifest.ts";

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
const DECISIONS = new Set(["import", "rejected", "deferred", "manual-review"]);

/** Expected checksums (resolved decisions; live source snapshot). */
const EXPECT = {
  total: 88,
  firstHand: 64,
  community: 24,
  import: 76,
  rejected: 8,
  deferred: 4,
  manualReview: 0,
  firstHandImport: 57,
  communityImport: 19,
};

const errors = [];
const notes = [];
const fail = (m) => errors.push(m);

const records = LEGACY_MANIFEST;
// "retained" / "import candidate" == decision === "import".
const imports = records.filter((r) => r.decision === "import");

// --- 1. exact total -------------------------------------------------------
if (records.length !== EXPECT.total) {
  fail(`expected ${EXPECT.total} legacy records, found ${records.length}`);
}

// --- 2. unique legacy_id within each collection -------------------------
for (const col of ["first-hand", "community"]) {
  const ids = records
    .filter((r) => r.legacy_collection === col)
    .map((r) => r.legacy_id);
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dupes.length) {
    fail(`duplicate legacy_id in ${col}: ${[...new Set(dupes)].join(", ")}`);
  }
}
{
  const all = records.map((r) => r.legacy_id);
  const dupes = all.filter((v, i) => all.indexOf(v) !== i);
  if (dupes.length) {
    fail(`duplicate legacy_id overall: ${[...new Set(dupes)].join(", ")}`);
  }
}

// --- 3. every record has a decision ------------------------------------
for (const r of records) {
  if (!r.decision || !DECISIONS.has(r.decision)) {
    fail(`${r.legacy_id}: missing or invalid decision (${r.decision})`);
  }
  if (!r.decision_reason || !r.decision_reason.trim()) {
    fail(`${r.legacy_id}: missing decision_reason`);
  }
  if (!r.legacy_title || !r.legacy_page_url) {
    fail(`${r.legacy_id}: missing legacy_title / legacy_page_url`);
  }
  if (!Array.isArray(r.sources)) {
    fail(`${r.legacy_id}: sources must be an array`);
  }
}

// --- 4. every import record has >= 1 valid event-video source ---------
for (const r of imports) {
  const videoSources = (r.sources || []).filter(
    (s) => s.is_event_video === true && s.media_kind === "video",
  );
  if (videoSources.length < 1) {
    fail(
      `${r.legacy_id}: decision=import but has no source with is_event_video=true && media_kind="video"`,
    );
  }
}

// --- 5. every import record is curator-reviewed ----------------------
for (const r of imports) {
  if (r.review_status !== "curator-reviewed") {
    fail(
      `${r.legacy_id}: decision=import but review_status=${JSON.stringify(r.review_status)} (must be "curator-reviewed")`,
    );
  }
}

// --- 6. import records use valid existing taxonomy / valence /
//        automation-status / causation / date precision ----------------
for (const r of imports) {
  if (!EVENT_TYPES.has(r.event_type)) {
    fail(`${r.legacy_id}: invalid event_type ${JSON.stringify(r.event_type)}`);
  }
  if (!VALENCES.has(r.valence)) {
    fail(`${r.legacy_id}: invalid valence ${JSON.stringify(r.valence)}`);
  }
  if (!AUTOMATION_STATUSES.has(r.automation_status)) {
    fail(
      `${r.legacy_id}: invalid automation_status ${JSON.stringify(r.automation_status)}`,
    );
  }
  if (r.automation_status === "driving-automation-engaged-confirmed") {
    if (r.legacy_collection !== "first-hand") {
      fail(
        `${r.legacy_id}: automation_status "confirmed" only expected for first-hand records`,
      );
    }
  }
  if (!CAUSATION_STATUSES.has(r.causal_attribution)) {
    fail(
      `${r.legacy_id}: invalid causal_attribution ${JSON.stringify(r.causal_attribution)}`,
    );
  }
  if (!DATE_PRECISIONS.has(r.event_date_precision)) {
    fail(
      `${r.legacy_id}: invalid event_date_precision ${JSON.stringify(r.event_date_precision)}`,
    );
  }
  const dateNull = r.event_date == null;
  const precUnknown = r.event_date_precision === "unknown";
  if (dateNull !== precUnknown) {
    fail(
      `${r.legacy_id}: event_date (${JSON.stringify(r.event_date)}) and event_date_precision (${r.event_date_precision}) disagree — null date <=> "unknown"`,
    );
  }
  if (r.event_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(r.event_date)) {
    fail(`${r.legacy_id}: event_date not ISO YYYY-MM-DD (${r.event_date})`);
  }
  if (
    r.location_country_code != null &&
    !/^[A-Z]{2}$/.test(r.location_country_code)
  ) {
    fail(
      `${r.legacy_id}: location_country_code not ISO alpha-2 (${r.location_country_code})`,
    );
  }
  if (!Array.isArray(r.observable_evidence) || r.observable_evidence.length < 1) {
    fail(`${r.legacy_id}: import record needs >= 1 observable_evidence item`);
  }
  if (!Array.isArray(r.what_remains_unknown) || r.what_remains_unknown.length < 1) {
    fail(`${r.legacy_id}: import record needs >= 1 what_remains_unknown item`);
  }
  if (!r.summary || !r.summary.trim()) {
    fail(`${r.legacy_id}: import record needs a summary`);
  }
  if (!r.proposed_title || !r.proposed_title.trim()) {
    fail(`${r.legacy_id}: import record needs a proposed_title`);
  }
}

// --- 7. source shape sanity for all records --------------------------
for (const r of records) {
  for (const s of r.sources || []) {
    if (!SOURCE_TYPES.has(s.source_type)) {
      fail(`${r.legacy_id}: invalid source_type ${JSON.stringify(s.source_type)}`);
    }
    if (typeof s.source_url !== "string" || !/^https?:\/\//.test(s.source_url)) {
      fail(`${r.legacy_id}: source_url not an http(s) URL (${s.source_url})`);
    }
    if (typeof s.is_event_video !== "boolean") {
      fail(`${r.legacy_id}: source.is_event_video must be boolean`);
    }
    if (!["video", "image", "article", "none", "unknown"].includes(s.media_kind)) {
      fail(`${r.legacy_id}: invalid media_kind ${JSON.stringify(s.media_kind)}`);
    }
  }
}

// --- 8. no rejected / deferred / manual-review record is import-shaped
//        (decision is the single source of truth for import selection).
//        review_status = "curator-reviewed" is an import-only field.
//        A "rejected" record must not carry a valid event-video source;
//        "deferred" / "manual-review" MAY (the video can exist while the
//        record is held back for substance / verification).
for (const r of records) {
  if (r.decision === "import") continue;
  if (r.review_status === "curator-reviewed") {
    fail(
      `${r.legacy_id}: decision=${r.decision} but review_status="curator-reviewed" (import-only field set)`,
    );
  }
  if (
    r.decision === "rejected" &&
    (r.sources || []).some((s) => s.is_event_video === true)
  ) {
    fail(
      `${r.legacy_id}: decision=rejected but a source is marked is_event_video=true`,
    );
  }
}

// --- 9. media identifiers unique or explained -----------------------
{
  const seen = new Map(); // canonical_media_id -> [legacy_id...]
  for (const r of records) {
    for (const s of r.sources || []) {
      if (!s.canonical_media_id) continue;
      const list = seen.get(s.canonical_media_id) || [];
      list.push(r.legacy_id);
      seen.set(s.canonical_media_id, list);
    }
  }
  for (const [id, list] of seen) {
    if (list.length > 1) {
      fail(
        `canonical_media_id ${id} appears in multiple records: ${list.join(", ")} (must be unique or explicitly explained)`,
      );
    }
  }
}

// --- 10. duplicate_of references resolve ---------------------------
{
  const idSet = new Set(records.map((r) => r.legacy_id));
  const slugSet = new Set(EXISTING_OBSERVATORY_EVENTS.map((e) => e.slug));
  for (const r of records) {
    if (r.duplicate_status === "unique") {
      if (r.duplicate_of != null) {
        fail(`${r.legacy_id}: duplicate_status "unique" but duplicate_of is set`);
      }
      continue;
    }
    if (!r.duplicate_of) {
      fail(
        `${r.legacy_id}: duplicate_status "${r.duplicate_status}" but no duplicate_of`,
      );
      continue;
    }
    if (!idSet.has(r.duplicate_of) && !slugSet.has(r.duplicate_of)) {
      fail(
        `${r.legacy_id}: duplicate_of "${r.duplicate_of}" does not resolve to a legacy_id or an existing Observatory slug`,
      );
    }
  }
}

// --- 11. exact deduplication against the existing 9 --------------------
const existingMediaId = new Map(); // media id -> slug
for (const e of EXISTING_OBSERVATORY_EVENTS) {
  for (const m of e.media_ids) existingMediaId.set(m, e.slug);
}
const normUrl = (u) =>
  u
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
const existingUrlNorms = new Set(); // (the 9 events' own source URLs, for completeness)

const exactDuplicates = [];
for (const r of records) {
  for (const s of r.sources || []) {
    if (s.canonical_media_id && existingMediaId.has(s.canonical_media_id)) {
      exactDuplicates.push({
        legacy_id: r.legacy_id,
        slug: existingMediaId.get(s.canonical_media_id),
        match: `canonical_media_id ${s.canonical_media_id}`,
      });
    } else if (existingUrlNorms.has(normUrl(s.source_url))) {
      exactDuplicates.push({
        legacy_id: r.legacy_id,
        slug: "(url match)",
        match: `normalised source_url ${normUrl(s.source_url)}`,
      });
    }
  }
  if (r.duplicate_status === "exact-duplicate-of-existing-9" && r.decision === "import") {
    fail(
      `${r.legacy_id}: marked exact-duplicate-of-existing-9 but decision=import`,
    );
  }
}
for (const d of exactDuplicates) {
  if (
    d.slug !== "(url match)" &&
    !records.find(
      (r) =>
        r.legacy_id === d.legacy_id &&
        r.duplicate_status === "exact-duplicate-of-existing-9",
    )
  ) {
    fail(
      `${d.legacy_id}: media identifier matches existing event ${d.slug} but duplicate_status is not "exact-duplicate-of-existing-9"`,
    );
  }
}

// --- 12. checksum reconciliation (report-only where it deviates) -----
const fh = records.filter((r) => r.legacy_collection === "first-hand");
const cr = records.filter((r) => r.legacy_collection === "community");
const count = (arr, d) => arr.filter((r) => r.decision === d).length;

if (fh.length !== EXPECT.firstHand) fail(`first-hand count ${fh.length} != ${EXPECT.firstHand}`);
if (cr.length !== EXPECT.community) fail(`community count ${cr.length} != ${EXPECT.community}`);
if (count(fh, "import") !== EXPECT.firstHandImport) {
  fail(`first-hand imports ${count(fh, "import")} != ${EXPECT.firstHandImport}`);
}
if (count(cr, "import") !== EXPECT.communityImport) {
  fail(`community imports ${count(cr, "import")} != ${EXPECT.communityImport}`);
}
for (const [key, dec] of [
  ["import", "import"],
  ["rejected", "rejected"],
  ["deferred", "deferred"],
  ["manualReview", "manual-review"],
]) {
  if (count(records, dec) !== EXPECT[key]) {
    fail(`${dec} count ${count(records, dec)} != expected ${EXPECT[key]}`);
  }
}

// --- report ----------------------------------------------------------
const line = "-".repeat(64);
console.log(line);
console.log("LEGACY MIGRATION MANIFEST — VALIDATION");
console.log(line);
console.log(`records ................. ${records.length}`);
console.log(`  first-hand ........... ${fh.length}  (import ${count(fh, "import")}, rejected ${count(fh, "rejected")}, deferred ${count(fh, "deferred")}, manual-review ${count(fh, "manual-review")})`);
console.log(`  community ............ ${cr.length}  (import ${count(cr, "import")}, rejected ${count(cr, "rejected")}, deferred ${count(cr, "deferred")}, manual-review ${count(cr, "manual-review")})`);
console.log(`import candidates ....... ${count(records, "import")}`);
console.log(`rejected ................ ${count(records, "rejected")}`);
console.log(`deferred ............... ${count(records, "deferred")}`);
console.log(`manual-review .......... ${count(records, "manual-review")}`);
console.log(`possible-duplicate flags  ${records.filter((r) => r.duplicate_status === "possible-duplicate-review").length}`);
console.log(`exact duplicates of the 9 ${exactDuplicates.length}`);
if (exactDuplicates.length) {
  for (const d of exactDuplicates) {
    console.log(`    ${d.legacy_id} == ${d.slug}  (${d.match})`);
  }
}
console.log(line);

for (const n of notes) console.log(`NOTE:    ${n}`);

if (errors.length) {
  console.log(line);
  for (const e of errors) console.log(`FAIL:    ${e}`);
  console.log(line);
  console.log(`VALIDATION FAILED — ${errors.length} error(s)`);
  process.exit(1);
}
console.log("VALIDATION PASSED");

/**
 * Pure mapping: one normalized NHTSA candidate (+ its already-computed
 * evidence atoms, classification, and contributing reports) -> one
 * WBA-shaped private `event` object + one `event_source` object per
 * contributing report.
 *
 * NOTHING in this file reads raw narrative text, calls any normalization
 * function, or changes any classification. It only reshapes ALREADY-COMPUTED
 * values (from evidence.mjs/classify.mjs, imported and run unmodified by the
 * caller) into the column names `supabase/migrations/20260829235332_
 * observatory_core.sql` / `20260905000000_event_source_regulatory_record.sql`
 * define. No curator-written prose (title/summary/observed_facts/
 * interpretation) is ever generated here — every one of those stays null/
 * empty, matching the existing `approve_submission_and_create_draft()`
 * precedent for a curator-incomplete private draft.
 */

import { createHash } from "node:crypto";

/**
 * Fixed for this entire generation batch — deliberately NOT `new Date()` at
 * runtime, so `event.record_updated` does not change across reruns on
 * different calendar days and the primary output stays byte-identical.
 * Update this constant (and re-generate) only when a genuinely new batch is
 * produced.
 */
export const GENERATION_BATCH_DATE = "2026-09-06";

/**
 * A single canonical NHTSA source URL for every event_source row is decided
 * at promotion time, not here (see build-promotion-sql.mjs's
 * CANONICAL_NHTSA_URL). `event_source.url` is therefore left `null` in this
 * DRY-RUN representation only — the real `event_source.url` column is NOT
 * NULL, so this is explicitly a promotion-time precondition to satisfy, not
 * a dry-run defect. qa-checks.mjs reports this every run; it is never
 * invented here.
 */
export const NHTSA_SOURCE_URL_UNRESOLVED = null;

function findAtomValue(atoms, field) {
  return atoms.find((a) => a.field === field)?.value ?? null;
}

/**
 * A stable, deterministic identity for one candidate — used only inside this
 * generator (as the JSONL `candidateId` and as slug input), never written to
 * any DB column. `same_incident_id` when present; otherwise the candidate's
 * single contributing report's own stable key
 * (`nhtsa_report`'s own `unique (reporting_generation, report_id)`).
 * Deliberately not a random UUID — determinism across reruns requires no
 * randomness anywhere in this generator.
 */
export function candidateIdentityKey(candidate) {
  if (candidate.same_incident_id) return `same-incident:${candidate.same_incident_id}`;
  const key = candidate._contributingReportKeys[0];
  return `singleton:${key.reporting_generation}:${key.report_id}`;
}

function md5Hex8(input) {
  return createHash("md5").update(input).digest("hex").slice(0, 8);
}

/**
 * Deterministic placeholder slug, same convention as
 * `approve_submission_and_create_draft()`'s `'draft-' || left(md5(...), 8)`
 * (supabase/migrations/20260903000000_submission_to_draft_conversion.sql) —
 * an `nhtsa-` prefix instead of `draft-` so the two placeholder families
 * stay distinguishable, but the same "8 lower-case hex characters from an
 * md5 of a stable identifier" shape. A curator replaces this before
 * publication, exactly as for a submission-derived draft.
 */
export function slugFor(candidate) {
  return `nhtsa-${md5Hex8(candidateIdentityKey(candidate))}`;
}

/**
 * Deterministic, structured-field-only location text — never free-text
 * generation. Uses the cosmetically-resolved city when evidence.mjs derived
 * one (`city_canonical`), otherwise the candidate's own `city` field, joined
 * with `state`/`country_code` exactly as given (no name expansion, e.g. no
 * "AZ" -> "Arizona" translation, since that would be inventing content the
 * source data does not literally contain).
 */
export function formatLocationText(candidate, atoms) {
  const city = findAtomValue(atoms, "city_canonical") ?? candidate.city;
  const parts = [city, candidate.state, candidate.country_code].filter(
    (v) => typeof v === "string" && v.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Canonical developer/operator name when evidence.mjs's alias table
 * resolved one from a contributing-report disagreement; otherwise the
 * candidate's own consolidated field. Never a new canonicalization decision
 * — reuses exactly what the frozen pipeline already computed. */
export function resolvedDeveloperOrOperator(candidate, atoms) {
  return findAtomValue(atoms, "developer_or_operator_canonical") ?? candidate.developer_or_operator ?? null;
}

/**
 * Map one candidate (+ its atoms/classification/already-built `unknowns`
 * array) to a private, WBA-shaped `event` object (private until promotion —
 * see docs/nhtsa-normalization-rulebook.md and DATA_PROVENANCE.md for the
 * curated/source-derived origin model this fits into). Every field's origin
 * is documented inline, next to that field, below.
 */
export function mapCandidateToEvent(candidate, atoms, classification, unknowns) {
  const locationPrecision = findAtomValue(atoms, "location_precision") ?? "unknown";
  return {
    // id: omitted — DB-owned on real insert.
    slug: slugFor(candidate), // SYSTEM/METADATA — deterministic placeholder
    title: null, // LEFT NULL — no curator-written headline exists yet
    summary: null, // LEFT NULL — no curator-written summary exists yet
    occurred_on: candidate.incident_date, // DERIVED — already period-start-pinned by mapping.mjs
    occurred_on_precision: candidate.incident_date_precision, // DERIVED
    location_text: formatLocationText(candidate, atoms), // SOURCE EVIDENCE (mechanical format)
    location_country_code: candidate.country_code ?? null, // DERIVED
    location_precision: locationPrecision, // CLASSIFICATION — frozen pipeline's own result, never exceeds "city"
    developer_or_operator: resolvedDeveloperOrOperator(candidate, atoms), // SOURCE EVIDENCE
    system_name: null, // LEFT NULL — no reliable NHTSA field
    automation_status: classification.automation_status.value, // CLASSIFICATION
    system_version: null, // LEFT NULL — no evidence source
    system_version_knowledge: "unknown", // LEFT UNKNOWN
    event_type: classification.event_type.value, // CLASSIFICATION
    valence: classification.valence.value, // CLASSIFICATION
    observed_facts: [], // LEFT EMPTY — no curator-written observed facts yet
    unknowns: [...unknowns], // DERIVED — exact carry-forward, see build-unknowns.mjs
    interpretation: null, // LEFT NULL — pure curator territory
    causation_status: classification.causation_status.value, // CLASSIFICATION
    // DERIVED — the frozen classification's own justification, verbatim, for
    // EVERY causation_status including "undetermined" (per explicit
    // instruction: this is not new causal prose, it is the same sentence
    // classify.mjs already produced and that a curator would already read).
    causation_note: classification.causation_status.justification ?? null,
    scenario_tags: classification.scenario_tags.value ?? [], // CLASSIFICATION (may be UNSUPPORTED -> null -> [])
    review_status: null, // LEFT NULL — no curator has reviewed this record
    record_updated: GENERATION_BATCH_DATE, // SYSTEM/METADATA — fixed batch constant
    is_public: false, // SYSTEM/METADATA — always false for this phase
  };
}

/**
 * Map one contributing NHTSA report to one `event_source` object. One row
 * per report — never flattened to one row per candidate — so a multi-report
 * candidate's full source picture (e.g. two separately-filed corporate
 * reporters) remains individually traceable, per the project's
 * "preserve multiple sources per event" principle.
 */
export function mapReportToEventSource(report) {
  return {
    url: NHTSA_SOURCE_URL_UNRESOLVED, // SYSTEM/METADATA — unresolved for this dry run; production blocker
    source_type: "regulatory-record",
    // SOURCE EVIDENCE — namespaced because `report_id` is only unique WITHIN
    // one `reporting_generation` (nhtsa_report's own UNIQUE constraint).
    external_record_id: `${report.reporting_generation}:${report.report_id}`,
    publisher: report.reporting_entity ?? null, // SOURCE EVIDENCE
    // DERIVED — a deterministic, factual label; not curator prose.
    label: `NHTSA SGO report ${report.report_id} (v${report.report_version})`,
    published_on: report.report_submission_date ?? null, // SOURCE EVIDENCE
    published_on_precision: report.report_submission_date ? "month" : "unknown", // DERIVED, per nhtsa_report's own documented month-only convention
    retrieved_on: report.retrieved_on ?? null, // SYSTEM/METADATA — pipeline retrieval metadata
    note: null, // LEFT NULL — no auto-generated prose
  };
}

/**
 * Map one fully-processed candidate (already run through the frozen
 * evidence.mjs/classify.mjs, plus its paired contributing reports and
 * already-built `unknowns` array) to the complete
 * `{ candidateId, sameIncidentId, event, eventSources }` record this
 * generator writes to `wba-events-dry-run.jsonl`.
 */
export function mapCandidateToWbaRecords({ candidate, reports, atoms, classification, unknowns }) {
  return {
    candidateId: candidateIdentityKey(candidate),
    sameIncidentId: candidate.same_incident_id,
    event: mapCandidateToEvent(candidate, atoms, classification, unknowns),
    eventSources: reports.map(mapReportToEventSource),
  };
}

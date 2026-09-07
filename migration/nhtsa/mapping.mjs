/**
 * NHTSA SGO ADS CSV -> nhtsa_report / nhtsa_incident_candidate mapping.
 *
 * Pure, deterministic functions only — no AI, no I/O, no database access.
 * Every rule here implements one bullet from the approved mapping (see the
 * task that produced this file / migration/nhtsa/import.mjs's header
 * comment). Given the same CSV bytes, this module always produces the same
 * output.
 */

const MONTH_MAP = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

const ADMIN_PLACEHOLDER_REPORT_TYPE = "No New or Updated Incident Reports";

/** "" / null / undefined -> null; otherwise the trimmed string. */
export function trimOrNull(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length > 0 ? t : null;
}

/**
 * NHTSA's "MON-YYYY" field -> { date, precision } using this schema's
 * existing (value, precision) convention: a blank field is unknown (null +
 * 'unknown'); a well-formed field becomes the first day of that month with
 * precision 'month' — never a fabricated day-level precision. A value that
 * does not match MON-YYYY is treated as unknown but flagged as an anomaly
 * for the caller to log (it is never silently discarded without a trace).
 */
export function parseMonthYear(raw) {
  const v = trimOrNull(raw);
  if (v === null) return { date: null, precision: "unknown", malformed: false };

  const m = /^([A-Za-z]{3})-(\d{4})$/.exec(v);
  if (!m) return { date: null, precision: "unknown", malformed: true, raw: v };

  const mon = MONTH_MAP[m[1].toUpperCase()];
  if (!mon) return { date: null, precision: "unknown", malformed: true, raw: v };

  return { date: `${m[2]}-${mon}-01`, precision: "month", malformed: false };
}

/** Today's date as YYYY-MM-DD, in local time — the importer's retrieved_on. */
export function todayIsoDate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Filter administrative placeholder rows ("no new or updated incident
 * reports this period"). Applied identically to both generations per the
 * approved rule; the current generation is expected to contain none, and
 * the caller is expected to surface a nonzero count there as an anomaly.
 */
export function excludeAdminPlaceholders(records) {
  const kept = [];
  let excluded = 0;
  for (const rec of records) {
    if (rec["Report Type"] === ADMIN_PLACEHOLDER_REPORT_TYPE) excluded++;
    else kept.push(rec);
  }
  return { kept, excluded };
}

/**
 * Group by Report ID and retain only the highest Report Version per group.
 * Report IDs are never merged across generations at this stage — call this
 * once per generation. A non-integer Report Version is recorded as a
 * malformed-version anomaly and that row is skipped (excluded from both the
 * latest-version set and any candidate downstream), since an unorderable
 * version cannot be safely compared to its siblings.
 */
export function latestVersionByReportId(records) {
  const byId = new Map();
  const malformed = [];

  for (const rec of records) {
    const reportId = trimOrNull(rec["Report ID"]);
    const versionRaw = trimOrNull(rec["Report Version"]);
    if (reportId === null || versionRaw === null || !/^\d+$/.test(versionRaw)) {
      malformed.push({ reportId: rec["Report ID"], version: rec["Report Version"] });
      continue;
    }
    const version = parseInt(versionRaw, 10);
    const current = byId.get(reportId);
    if (!current || version > current.version) {
      byId.set(reportId, { version, record: rec });
    }
  }

  return { latest: [...byId.values()].map((x) => x.record), malformed };
}

/**
 * Map one latest-version CSV record to the nhtsa_report shape.
 * `generation` is 'historical' | 'current'; `retrievedOn` is the shared
 * import-date stamp (YYYY-MM-DD) applied to every row in this run.
 */
export function mapToReport(rec, generation, retrievedOn) {
  const reportId = trimOrNull(rec["Report ID"]);
  const reportVersion = parseInt(trimOrNull(rec["Report Version"]), 10);
  const sameIncidentId = trimOrNull(rec["Same Incident ID"]);
  const reportingEntity = trimOrNull(rec["Reporting Entity"]);
  const operatingEntity = trimOrNull(rec["Operating Entity"]);
  const developerOrOperator = operatingEntity ?? reportingEntity;

  const incident = parseMonthYear(rec["Incident Date"]);
  const submission = parseMonthYear(rec["Report Submission Date"]);

  const automationEngagementText =
    generation === "current" ? trimOrNull(rec["Engagement Status"]) : null;

  const anomalies = [];
  if (incident.malformed) {
    anomalies.push({ type: "malformed-incident-date", reportId, generation, value: incident.raw });
  }
  if (submission.malformed) {
    anomalies.push({ type: "malformed-submission-date", reportId, generation, value: submission.raw });
  }
  if (reportingEntity === null) {
    anomalies.push({ type: "blank-reporting-entity", reportId, generation });
  }

  const report = {
    reporting_generation: generation,
    report_id: reportId,
    report_version: reportVersion,
    same_incident_id: sameIncidentId,
    reporting_entity: reportingEntity,
    developer_or_operator: developerOrOperator,
    incident_date: incident.date,
    incident_date_precision: incident.precision,
    report_submission_date: submission.date,
    city: trimOrNull(rec["City"]),
    state: trimOrNull(rec["State"]),
    country_code: "US",
    automation_engagement_text: automationEngagementText,
    crash_interaction_counterpart_text: trimOrNull(rec["Crash With"]),
    subject_vehicle_precrash_movement_text: trimOrNull(rec["SV Pre-Crash Movement"]),
    other_actor_precrash_movement_text: trimOrNull(rec["CP Pre-Crash Movement"]),
    injury_outcome_text: trimOrNull(rec["Highest Injury Severity Alleged"]),
    narrative: trimOrNull(rec["Narrative"]),
    raw_row: rec,
    retrieved_on: retrievedOn,
  };

  return { report, anomalies };
}

/** Set of distinct non-null values in `values` (already-trimmed strings). */
function distinctNonNull(values) {
  return new Set(values.filter((v) => v !== null));
}

/**
 * Mechanical single-field consolidation across a group of contributing
 * reports: if every non-null value agrees, use it (null members are simply
 * ignored, not treated as a disagreement); if two or more distinct non-null
 * values exist, the field is left null and the disagreement is logged for
 * curator review. Never invents a canonical value.
 */
function consolidateField(reports, field) {
  const values = reports.map((r) => r[field]);
  const distinct = distinctNonNull(values);
  if (distinct.size === 0) return { value: null, disagreement: null };
  if (distinct.size === 1) return { value: [...distinct][0], disagreement: null };
  return {
    value: null,
    disagreement: { field, values: [...distinct] },
  };
}

/** incident_date / incident_date_precision are consolidated as one pair. */
function consolidateIncidentDate(reports) {
  const nonUnknown = reports
    .filter((r) => r.incident_date_precision !== "unknown")
    .map((r) => `${r.incident_date}|${r.incident_date_precision}`);
  const distinct = new Set(nonUnknown);
  if (distinct.size === 0) return { date: null, precision: "unknown", disagreement: null };
  if (distinct.size === 1) {
    const [date, precision] = [...distinct][0].split("|");
    return { date, precision, disagreement: null };
  }
  return {
    date: null,
    precision: "unknown",
    disagreement: { field: "incident_date", values: [...distinct] },
  };
}

/** Legal/filing-boilerplate phrases that indicate a narrative is a duplicate
 * co-filer's administrative wrapper rather than a substantive account of the
 * event itself. Found, in the targeted adversarial stress test, to
 * consistently outrank a co-filer's actual crash narrative under the
 * previous longest-narrative-wins heuristic — in both sampled GM/Cruise
 * duplicate filings, GM's administrative wrapper narrative ran longer than
 * Cruise's substantive account of the same incident (see
 * migration/nhtsa/normalization/stress-test/stress-test-report.md, finding
 * 1, cases d9ef2eb5a3957bb and 34e9268c40d9f69). This is a narrow,
 * explainable proxy grounded in the exact phrasing observed in those
 * reproduced cases — not a semantic understanding of the narrative. */
const ADMINISTRATIVE_BOILERPLATE_PATTERNS = [
  /filed (an|a) (incident )?report/i,
  /standing general order/i,
  /is submitting a duplicate/i,
  /solely to avoid/i,
  /incorporates?[^.]{0,60}by reference/i,
  /based on facts supplied to/i,
  /has not investigated the alleged incident/i,
  /no independent knowledge of the facts/i,
  /manufactured the[^.]{0,60}operated motor vehicle/i,
];

/** Concrete crash-mechanics vocabulary. Presence indicates a narrative is
 * describing the actual event (actors, movement, roadway context, contact)
 * rather than only the filing/administrative wrapper around it. Deliberately
 * broad, ordinary crash-report vocabulary — not tuned to any one case. */
const EVENT_BEARING_PATTERNS = [
  /\b(travel(l)?ing|proceeding|approach(ed|ing)?|stopped|parked|braked|brake|accelerat\w*|decelerat\w*)\b/i,
  /\b(collision|collided|contact|struck|strike|rear-ended|swerv\w*|veer\w*)\b/i,
  /\b(lane|intersection|roadway|crosswalk|shoulder|median)\b/i,
  /\b(pedestrian|cyclist|vehicle|truck|driver|passenger)\b/i,
];

function countMatches(text, patterns) {
  return patterns.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
}

/** Deterministic evidence-bearing score: +1 per distinct event-bearing
 * vocabulary group present, -2 per distinct administrative-boilerplate
 * phrase present. This is not semantic understanding — it is a narrow,
 * explainable, keyword-based proxy. Calibrated against the actual stress-test
 * fixture: a full administrative-wrapper narrative scores strongly negative
 * (e.g. -17), a substantive narrative that merely closes with one ordinary
 * "reporting this crash under Standing General Order..." sentence loses only
 * 2 points against 3-4 gained for its actual content, and two near-identical
 * substantive narratives differing only in incidental administrative detail
 * (e.g. one adds "the report was submitted from the Pacific time zone")
 * still score identically, leaving the tie-break below — unchanged from the
 * prior behavior — to decide between them. */
function evidenceBearingScore(narrative) {
  return countMatches(narrative, EVENT_BEARING_PATTERNS) - 2 * countMatches(narrative, ADMINISTRATIVE_BOILERPLATE_PATTERNS);
}

/**
 * Choose one representative narrative from a group, deterministically:
 * highest evidence-bearing score (see evidenceBearingScore above) wins;
 * ties are broken by the ORIGINAL rule — longest non-blank narrative, then
 * ascending (reporting_generation, report_id) — so behavior is unchanged
 * from before for the common case where several contributing narratives are
 * near-duplicates of each other. This picks text; it never merges or
 * rewrites narratives, and never removes or overrides any other
 * contributing report's narrative from the reports array itself — narrative
 * SELECTION and disagreement PRESERVATION are separate concerns (see
 * evidence.mjs's detectSourceRecordInconsistency for the latter).
 *
 * FIXED (targeted adversarial stress test, cases d9ef2eb5a3957bb /
 * 34e9268c40d9f69): the previous "longest wins" rule let a duplicate
 * co-filer's administrative boilerplate (long, factually empty) outrank the
 * operating entity's own, shorter, substantive account of the crash.
 */
function representativeNarrative(reports) {
  const withNarrative = reports.filter((r) => r.narrative !== null);
  if (withNarrative.length === 0) return null;
  const sorted = [...withNarrative].sort((a, b) => {
    const scoreDiff = evidenceBearingScore(b.narrative) - evidenceBearingScore(a.narrative);
    if (scoreDiff !== 0) return scoreDiff;
    const lenDiff = b.narrative.length - a.narrative.length;
    if (lenDiff !== 0) return lenDiff;
    if (a.reporting_generation !== b.reporting_generation) {
      return a.reporting_generation < b.reporting_generation ? -1 : 1;
    }
    return a.report_id < b.report_id ? -1 : a.report_id > b.report_id ? 1 : 0;
  });
  return sorted[0].narrative;
}

const MIRROR_FIELDS = [
  "developer_or_operator",
  "city",
  "state",
  "automation_engagement_text",
  "crash_interaction_counterpart_text",
  "subject_vehicle_precrash_movement_text",
  "other_actor_precrash_movement_text",
  "injury_outcome_text",
];

/**
 * Build one candidate from its contributing reports (1 for a singleton, 2+
 * for a Same Incident ID group). `sameIncidentId` is null for a singleton.
 */
export function consolidateCandidate(reports, sameIncidentId) {
  const disagreements = [];
  const consolidated = {};

  for (const field of MIRROR_FIELDS) {
    const { value, disagreement } = consolidateField(reports, field);
    consolidated[field] = value;
    if (disagreement) disagreements.push(disagreement);
  }

  const inc = consolidateIncidentDate(reports);
  if (inc.disagreement) disagreements.push(inc.disagreement);

  const curatorNote =
    disagreements.length > 0
      ? `Import: contributing reports disagree on ${disagreements
          .map((d) => `${d.field} (${d.values.join(" / ")})`)
          .join("; ")}. Left blank for curator review.`
      : null;

  return {
    same_incident_id: sameIncidentId,
    developer_or_operator: consolidated.developer_or_operator,
    system_or_vehicle_text: null,
    automation_engagement_text: consolidated.automation_engagement_text,
    incident_date: inc.date,
    incident_date_precision: inc.precision,
    city: consolidated.city,
    state: consolidated.state,
    country_code: "US",
    roadway_scenario_context: null,
    environmental_conditions: null,
    crash_interaction_counterpart: consolidated.crash_interaction_counterpart_text,
    subject_vehicle_precrash_movement: consolidated.subject_vehicle_precrash_movement_text,
    other_actor_precrash_movement: consolidated.other_actor_precrash_movement_text,
    injury_outcome_text: consolidated.injury_outcome_text,
    narrative: representativeNarrative(reports),
    proposed_observed_facts: [],
    proposed_scenario_tags: [],
    proposed_interpretation: null,
    proposed_uncertainties: [],
    dedup_status: "unreviewed",
    possible_duplicate_event_id: null,
    status: "pending",
    curator_note: curatorNote,
    linked_event_id: null,
    reviewed_by: null,
    reviewed_at: null,
    _disagreements: disagreements,
    _contributingReportKeys: reports.map((r) => ({
      reporting_generation: r.reporting_generation,
      report_id: r.report_id,
    })),
  };
}

/**
 * Group latest-version reports (already combined across both generations)
 * into candidates: one per unique non-null same_incident_id, one singleton
 * per report with a null same_incident_id.
 */
export function buildCandidates(reports) {
  const groups = new Map();
  const singletons = [];

  for (const r of reports) {
    if (r.same_incident_id === null) {
      singletons.push(r);
      continue;
    }
    if (!groups.has(r.same_incident_id)) groups.set(r.same_incident_id, []);
    groups.get(r.same_incident_id).push(r);
  }

  const grouped = [...groups.entries()].map(([sameIncidentId, members]) =>
    consolidateCandidate(members, sameIncidentId),
  );
  const singletonCandidates = singletons.map((r) => consolidateCandidate([r], null));

  return { grouped, singletonCandidates };
}

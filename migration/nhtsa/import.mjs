/**
 * NHTSA SGO ADS importer — Beta 1.1 Phase 2, mechanical staging import.
 *
 * Run:
 *   node migration/nhtsa/import.mjs                # dry-run (default): reads
 *                                                   #   the CSVs and the CLI's
 *                                                   #   linked production
 *                                                   #   project (read-only),
 *                                                   #   writes nothing, prints
 *                                                   #   the counts report.
 *   node migration/nhtsa/import.mjs --offline       # dry-run without the
 *                                                   #   read-only production
 *                                                   #   check (no network) —
 *                                                   #   insert/update/reuse/
 *                                                   #   no-op counts assume an
 *                                                   #   empty destination.
 *
 * WHAT THIS SCRIPT DOES
 *   A pure, deterministic transform: CSV rows -> latest version per Report ID
 *   -> nhtsa_report shape -> Same Incident ID grouping -> nhtsa_incident_
 *   candidate shape (migration/nhtsa/mapping.mjs has every mapping/
 *   consolidation rule). No AI, no interpretation, no inference of missing
 *   facts. Disagreements across contributing reports are logged, never
 *   silently resolved by invented canonicalization.
 *
 * WHAT THIS SCRIPT DOES NOT DO (yet)
 *   It does not write to the database in any mode. There is deliberately no
 *   --emit / --apply flag here: the production-write step (idempotent SQL
 *   generation, matching migration/legacy/build-import.mjs's build-then-
 *   review-then-apply pattern, and the singleton-candidate reuse strategy
 *   documented in mapping.mjs) is a separate, later, explicitly-approved
 *   change. This script's only job is to make the dry-run counts trustworthy.
 *
 * HOW IT TALKS TO SUPABASE
 *   Read-only, and only for the dry-run's insert/update/no-op classification:
 *   it shells out to `npx supabase db query --linked <sql>`, the same CLI
 *   command already used interactively throughout this project's migration
 *   work. That command authenticates via the Supabase CLI's own logged-in
 *   session (a Management API token), never a service-role key and never a
 *   curator password embedded in this script. No row is written by this
 *   script; the queries below are plain SELECTs.
 *
 * SOURCE FILES
 *   See pipeline.mjs's HISTORICAL_CSV / CURRENT_CSV: NHTSA_HISTORICAL_CSV /
 *   NHTSA_CURRENT_CSV env vars, else ./data/nhtsa/<filename> under the repo
 *   root. Not moved, renamed, or modified by this script.
 */

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runPipeline } from "./pipeline.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

// ---------------------------------------------------------------------------
// Read-only production-state check, for insert/update/no-op classification.
// ---------------------------------------------------------------------------

function queryLinked(sql) {
  if (sql.includes('"')) {
    throw new Error("queryLinked: fixed internal SQL must not contain double quotes");
  }
  const stdout = execSync(`npx supabase db query --linked "${sql}"`, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // The CLI prints a status line ("Initialising login role...") before the
  // JSON result; take the last line that parses as JSON.
  const lines = stdout.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const joined = lines.slice(i).join("\n");
      const parsed = JSON.parse(joined);
      return parsed.rows ?? [];
    } catch {
      continue;
    }
  }
  throw new Error(`Could not parse JSON from supabase db query output:\n${stdout}`);
}

function fetchProductionState() {
  const existingReports = queryLinked(
    "select reporting_generation, report_id, report_version, incident_candidate_id from public.nhtsa_report;",
  );
  const existingCandidatesBySameIncidentId = queryLinked(
    "select id, same_incident_id from public.nhtsa_incident_candidate where same_incident_id is not null;",
  );
  return { existingReports, existingCandidatesBySameIncidentId };
}

function classifyWrites(pipeline, prodState) {
  const reportKey = (gen, id) => `${gen}\u0000${id}`;

  let reportInsert = 0;
  let reportUpdate = 0;
  let reportNoOp = 0;
  const existingReportByKey = new Map();

  if (prodState) {
    for (const row of prodState.existingReports) {
      existingReportByKey.set(reportKey(row.reporting_generation, row.report_id), row);
    }
  }

  for (const r of pipeline.allReports) {
    const existing = existingReportByKey.get(reportKey(r.reporting_generation, r.report_id));
    if (!existing) reportInsert++;
    else if (Number(existing.report_version) !== r.report_version) reportUpdate++;
    else reportNoOp++;
  }

  const existingSameIncidentIds = new Set(
    (prodState?.existingCandidatesBySameIncidentId ?? []).map((r) => r.same_incident_id),
  );
  const candidateInsertGrouped = pipeline.grouped.filter(
    (c) => !existingSameIncidentIds.has(c.same_incident_id),
  ).length;
  const candidateReuseGrouped = pipeline.grouped.length - candidateInsertGrouped;

  let singletonInsert = 0;
  let singletonReuse = 0;
  for (const c of pipeline.singletonCandidates) {
    const [{ reporting_generation, report_id }] = c._contributingReportKeys;
    const existing = existingReportByKey.get(reportKey(reporting_generation, report_id));
    if (existing && existing.incident_candidate_id) singletonReuse++;
    else singletonInsert++;
  }

  return {
    reportInsert,
    reportUpdate,
    reportNoOp,
    candidateInsertGrouped,
    candidateReuseGrouped,
    singletonInsert,
    singletonReuse,
  };
}

// ---------------------------------------------------------------------------
// Report printing.
// ---------------------------------------------------------------------------

function printReport(pipeline, writeCounts, offline) {
  const line = "-".repeat(78);
  const allCandidates = [...pipeline.grouped, ...pipeline.singletonCandidates];
  const multiReportGroups = pipeline.grouped.filter(
    (c) => c._contributingReportKeys.length > 1,
  );

  const crossEntityGroups = pipeline.grouped.filter((c) => {
    const entities = new Set(
      c._contributingReportKeys
        .map((k) => pipeline.allReports.find(
          (r) => r.reporting_generation === k.reporting_generation && r.report_id === k.report_id,
        ))
        .map((r) => r.reporting_entity),
    );
    return entities.size > 1;
  });

  console.log(line);
  console.log(`NHTSA IMPORTER — DRY RUN (mode: ${offline ? "offline, no production read" : "production read-only check"})`);
  console.log(`retrieved_on (import date stamp): ${pipeline.retrievedOn}`);
  console.log(line);

  console.log("\n[1] Raw row counts by generation");
  for (const [gen, s] of Object.entries(pipeline.perGeneration)) {
    console.log(`  ${gen.padEnd(12)} raw=${s.rawCount}`);
  }

  console.log("\n[2] Excluded administrative placeholder rows (Report Type = 'No New or Updated Incident Reports')");
  for (const [gen, s] of Object.entries(pipeline.perGeneration)) {
    console.log(`  ${gen.padEnd(12)} excluded=${s.excludedAdminRows}`);
  }

  console.log("\n[3] Latest-version Report ID counts by generation (after admin-row exclusion)");
  for (const [gen, s] of Object.entries(pipeline.perGeneration)) {
    console.log(`  ${gen.padEnd(12)} latest_version_report_ids=${s.latestVersionCount}  malformed_version_rows_skipped=${s.malformedVersionCount}`);
  }
  console.log(`  TOTAL latest-version reports (both generations): ${pipeline.allReports.length}`);

  console.log("\n[4] Same Incident ID — blank / unique-non-null, by generation");
  for (const [gen, s] of Object.entries(pipeline.perGeneration)) {
    console.log(`  ${gen.padEnd(12)} blank=${s.blankSameIncidentId}  unique_non_null=${s.uniqueNonNullSameIncidentId}`);
  }
  const totalBlank = Object.values(pipeline.perGeneration).reduce((n, s) => n + s.blankSameIncidentId, 0);

  console.log("\n[5] Candidate construction");
  console.log(`  singleton candidates (blank Same Incident ID) ... ${pipeline.singletonCandidates.length}  (expect = total blank above: ${totalBlank})`);
  console.log(`  grouped candidates (unique non-null Same Incident ID, union across generations) ... ${pipeline.grouped.length}`);
  console.log(`  TOTAL expected candidates ... ${allCandidates.length}`);
  console.log(`  multi-report candidates (>1 contributing report) ... ${multiReportGroups.length}`);
  console.log(`    max contributing reports in one candidate: ${Math.max(0, ...multiReportGroups.map((c) => c._contributingReportKeys.length))}`);
  console.log(`  candidate groups spanning >1 distinct Reporting Entity ... ${crossEntityGroups.length}`);

  console.log("\n[6] Field disagreements encountered during mechanical consolidation");
  const withDisagreements = pipeline.grouped.filter((c) => c._disagreements.length > 0);
  console.log(`  candidates with >= 1 disagreement: ${withDisagreements.length} / ${pipeline.grouped.length} grouped candidates`);
  const disagreementsByField = {};
  for (const c of withDisagreements) {
    for (const d of c._disagreements) {
      disagreementsByField[d.field] = (disagreementsByField[d.field] ?? 0) + 1;
    }
  }
  console.log(`  by field: ${JSON.stringify(disagreementsByField)}`);
  console.log("  first 10 examples:");
  for (const c of withDisagreements.slice(0, 10)) {
    console.log(`    same_incident_id=${c.same_incident_id}: ${c._disagreements.map((d) => `${d.field}=[${d.values.join(" | ")}]`).join(", ")}`);
  }

  console.log("\n[7] Malformed / anomalous source data");
  console.log(`  malformed Report Version (non-integer, row skipped): ${pipeline.malformedVersions.length}`);
  for (const m of pipeline.malformedVersions.slice(0, 10)) console.log(`    ${JSON.stringify(m)}`);
  const dateAnomalies = pipeline.anomalies.filter((a) => a.type.startsWith("malformed-"));
  console.log(`  malformed Incident Date / Report Submission Date (kept as unknown, logged): ${dateAnomalies.length}`);
  for (const a of dateAnomalies.slice(0, 10)) console.log(`    ${JSON.stringify(a)}`);
  const blankRequired = pipeline.anomalies.filter((a) => a.type === "blank-reporting-entity");
  console.log(`  blank required field (Reporting Entity) among latest-version reports: ${blankRequired.length}`);
  for (const a of blankRequired.slice(0, 10)) console.log(`    ${JSON.stringify(a)}`);
  const currentAdminRows = pipeline.perGeneration.current?.excludedAdminRows ?? 0;
  if (currentAdminRows > 0) {
    console.log(`  ANOMALY: current-generation file contains ${currentAdminRows} administrative placeholder row(s) — none were expected. Reviewed and excluded identically to historical; confirm this is intended before proceeding.`);
  }

  console.log("\n[8] Would-be database writes");
  if (offline) {
    console.log("  (offline mode — production state not read; counts assume an empty destination)");
  }
  console.log(`  nhtsa_report:            insert=${writeCounts.reportInsert}  update=${writeCounts.reportUpdate}  no-op=${writeCounts.reportNoOp}`);
  console.log(`  nhtsa_incident_candidate (grouped, keyed by Same Incident ID): insert=${writeCounts.candidateInsertGrouped}  reuse=${writeCounts.candidateReuseGrouped}`);
  console.log(`  nhtsa_incident_candidate (singleton, keyed by report's existing link): insert=${writeCounts.singletonInsert}  reuse=${writeCounts.singletonReuse}`);
  console.log(`  TOTAL candidate writes: insert=${writeCounts.candidateInsertGrouped + writeCounts.singletonInsert}  reuse=${writeCounts.candidateReuseGrouped + writeCounts.singletonReuse}`);

  console.log(`\n${line}`);
  console.log("DRY RUN COMPLETE — no rows were written. No --emit/--apply mode exists yet in this script.");
  console.log(line);
}

function main() {
  const args = new Set(process.argv.slice(2));
  const offline = args.has("--offline");

  const pipeline = runPipeline();

  let prodState = null;
  if (!offline) {
    try {
      prodState = fetchProductionState();
    } catch (e) {
      console.error("Could not read production state read-only check; falling back to --offline assumptions.");
      console.error(String(e.message ?? e));
    }
  }

  const writeCounts = classifyWrites(pipeline, prodState);
  printReport(pipeline, writeCounts, prodState === null);
}

main();

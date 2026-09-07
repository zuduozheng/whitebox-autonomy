/**
 * Shared NHTSA CSV -> in-memory report/candidate pipeline.
 *
 * The SINGLE source of truth for "load the two CSVs and run the approved
 * mechanical transform" — both import.mjs (dry-run report) and
 * build-import-sql.mjs (SQL artifact generator) call runPipeline() from
 * here, so the two can never silently drift apart. Moving this out of
 * import.mjs is a pure refactor: the dry-run's printed counts are unchanged.
 *
 * Source files: NHTSA's own Standing General Order ADS incident-report CSVs
 * (https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting),
 * downloaded separately by whoever runs this pipeline — not committed to
 * this repository (see DATA_PROVENANCE.md). Path resolution, in order:
 *   1. the NHTSA_HISTORICAL_CSV / NHTSA_CURRENT_CSV environment variables,
 *      if set (absolute or relative to the current working directory);
 *   2. otherwise, ./data/nhtsa/<filename> relative to the repository root —
 *      place your downloaded CSVs there under their original NHTSA
 *      filenames, or point the env vars at wherever you saved them.
 */

import { readFileSync } from "node:fs";

import { parseCsv, rowToRecord } from "./csv.mjs";
import {
  excludeAdminPlaceholders,
  latestVersionByReportId,
  mapToReport,
  buildCandidates,
  todayIsoDate,
} from "./mapping.mjs";

export const HISTORICAL_CSV =
  process.env.NHTSA_HISTORICAL_CSV ??
  "./data/nhtsa/SGO-2021-01_Incident_Reports_ADS.csv";
export const CURRENT_CSV =
  process.env.NHTSA_CURRENT_CSV ??
  "./data/nhtsa/SGO-2021-01_Incident_Reports_ADS_June_2026.csv";

function loadGeneration(path, generation) {
  const text = readFileSync(path, "utf8");
  const { header, rows } = parseCsv(text);
  const records = rows.map((r) => rowToRecord(header, r));
  return { generation, path, rawCount: records.length, records };
}

export function runPipeline() {
  const retrievedOn = todayIsoDate();
  const anomalies = [];
  const malformedVersions = [];

  const generations = [
    loadGeneration(HISTORICAL_CSV, "historical"),
    loadGeneration(CURRENT_CSV, "current"),
  ];

  const perGeneration = {};
  const allReports = [];

  for (const gen of generations) {
    const { kept, excluded } = excludeAdminPlaceholders(gen.records);
    const { latest, malformed } = latestVersionByReportId(kept);
    for (const m of malformed) malformedVersions.push({ generation: gen.generation, ...m });

    const mapped = latest.map((rec) => mapToReport(rec, gen.generation, retrievedOn));
    for (const { anomalies: a } of mapped) anomalies.push(...a);

    const reports = mapped.map((m) => m.report);
    allReports.push(...reports);

    perGeneration[gen.generation] = {
      rawCount: gen.rawCount,
      excludedAdminRows: excluded,
      latestVersionCount: latest.length,
      malformedVersionCount: malformed.length,
      blankSameIncidentId: reports.filter((r) => r.same_incident_id === null).length,
      uniqueNonNullSameIncidentId: new Set(
        reports.filter((r) => r.same_incident_id !== null).map((r) => r.same_incident_id),
      ).size,
    };
  }

  const { grouped, singletonCandidates } = buildCandidates(allReports);

  return { retrievedOn, allReports, grouped, singletonCandidates, perGeneration, anomalies, malformedVersions };
}

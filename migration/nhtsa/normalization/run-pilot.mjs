/**
 * NHTSA -> WBA normalization pilot runner.
 *
 * Runs the full pipeline (evidence extraction -> classification ->
 * validation) against the 15 known calibration candidates ONLY, using the
 * frozen local fixture (calibration-fixture.json) rather than a live
 * database read — this pilot is meant to validate the architecture, not to
 * touch production again. No database connection of any kind is made by
 * this script.
 *
 * Usage:
 *   node migration/nhtsa/normalization/run-pilot.mjs
 *
 * Writes migration/nhtsa/normalization/pilot-output.json (local file, not a
 * database write) and prints a compact summary table to stdout.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { extractEvidence } from "./evidence.mjs";
import { classify } from "./classify.mjs";
import { validateDraft } from "./validate.mjs";

const DIR = fileURLToPath(new URL("./", import.meta.url));
const FIXTURE_PATH = DIR + "calibration-fixture.json";
const OUTPUT_PATH = DIR + "pilot-output.json";

/** Build the unknowns[] entries for disagreements not cosmetically resolved. */
function buildUnknowns(disagreements, developerCanonical, cityCanonical) {
  const unknowns = [];
  for (const d of disagreements) {
    if (d.field === "developer_or_operator" && developerCanonical) continue;
    if (d.field === "city" && cityCanonical) continue;
    unknowns.push(
      `Contributing reports disagree on ${d.field.replace(/_/g, " ")} (${d.values.join(" / ")}) — left unresolved for curator review.`,
    );
  }
  return unknowns;
}

function runOne(entry) {
  const { candidate, reports } = entry;
  const { atoms, disagreements } = extractEvidence(candidate, reports);
  const classificationResult = classify(atoms, disagreements);

  const locationPrecisionAtom = atoms.find((a) => a.field === "location_precision");
  const developerAliasAtom = atoms.find((a) => a.field === "developer_or_operator_canonical");
  const cityAliasAtom = atoms.find((a) => a.field === "city_canonical");

  const draft = {
    candidateId: candidate.id,
    sameIncidentId: candidate.same_incident_id,
    reportCount: reports.length,
    atoms,
    disagreements,
    classification: classificationResult,
    locationPrecision: locationPrecisionAtom?.value ?? "unknown",
    developerCanonical: developerAliasAtom?.value ?? null,
    cityCanonical: cityAliasAtom?.value ?? null,
    unknowns: buildUnknowns(disagreements, developerAliasAtom?.value ?? null, cityAliasAtom?.value ?? null),
  };

  const validation = validateDraft(draft);
  return { draft, validation };
}

function main() {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const results = fixture.map(runOne);

  const line = "-".repeat(160);
  console.log(line);
  console.log(
    "candidate".padEnd(10),
    "reports".padEnd(8),
    "event_type".padEnd(34),
    "valence".padEnd(20),
    "automation_status".padEnd(38),
    "causation_status".padEnd(28),
    "loc".padEnd(8),
    "valid",
  );
  console.log(line);
  for (const { draft, validation } of results) {
    const c = draft.classification;
    console.log(
      draft.candidateId.slice(0, 8).padEnd(10),
      String(draft.reportCount).padEnd(8),
      String(c.event_type.value).padEnd(34),
      String(c.valence.value).padEnd(20),
      String(c.automation_status.value).padEnd(38),
      String(c.causation_status.value).padEnd(28),
      String(draft.locationPrecision).padEnd(8),
      validation.ok ? "OK" : `FAIL(${validation.violations.length})`,
    );
    if (!validation.ok) {
      for (const v of validation.violations) console.log(`    [rule ${v.rule}] ${v.message}`);
    }
  }
  console.log(line);

  const totalViolations = results.reduce((n, r) => n + r.validation.violations.length, 0);
  console.log(`${results.length} candidates processed, ${totalViolations} validation violation(s) total.`);

  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      results.map((r) => ({ candidateId: r.draft.candidateId, draft: r.draft, validation: r.validation })),
      null,
      2,
    ) + "\n",
  );
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();

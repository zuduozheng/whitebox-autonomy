/**
 * Full-corpus WBA event dry-run generator.
 *
 * Runs the whole NHTSA -> WBA transformation over every candidate produced
 * by runPipeline() from your own NHTSA CSVs (see DATA_PROVENANCE.md and
 * pipeline.mjs for how to supply them), end to end:
 *
 *   NHTSA candidates (via runPipeline())
 *     -> normalization (extractEvidence / classify / validateDraft, per
 *        docs/nhtsa-normalization-rulebook.md)
 *     -> WBA-shaped generated event objects (map-candidate-to-event.mjs)
 *     -> full-corpus structural QA (qa-checks.mjs)
 *     -> three local output artifacts (below)
 *
 * NO database write of any kind. NO network access. Deterministic and
 * rerunnable: the only run-to-run variable is `report.retrieved_on`, which
 * is genuine pipeline retrieval metadata (today's date at the time
 * runPipeline() reads the CSVs) — reruns on the SAME calendar day produce a
 * byte-identical wba-events-dry-run.jsonl.
 *
 * Run: node migration/nhtsa/wba-events/generate-dry-run.mjs
 *
 * Writes, alongside this file (local output only — not committed to this
 * repository; see .gitignore):
 *   wba-events-dry-run.jsonl           one JSON object per candidate
 *   wba-events-dry-run-qa-summary.json full-corpus structural QA report
 *   wba-events-dry-run-problems.jsonl  any candidate that failed a check
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { runPipeline } from "../pipeline.mjs";
import { extractEvidence } from "../normalization/evidence.mjs";
import { classify } from "../normalization/classify.mjs";
import { validateDraft } from "../normalization/validate.mjs";
import { mapCandidateToWbaRecords, candidateIdentityKey, GENERATION_BATCH_DATE } from "./map-candidate-to-event.mjs";
import { runFullCorpusQa } from "./qa-checks.mjs";

const DIR = fileURLToPath(new URL("./", import.meta.url));
const OUTPUT_JSONL = DIR + "wba-events-dry-run.jsonl";
const QA_SUMMARY_PATH = DIR + "wba-events-dry-run-qa-summary.json";
const PROBLEMS_PATH = DIR + "wba-events-dry-run-problems.jsonl";

/**
 * Identical wording/logic to `scale-up-eval/run-scale-up.mjs` and
 * `post-fix/run-all.mjs`'s own `buildUnknowns()` — duplicated here rather
 * than imported, matching this codebase's existing convention (this exact
 * function already exists independently in two other scripts; a third,
 * read-only reuse site does not warrant exporting it from evidence.mjs,
 * which stays untouched per the frozen-normalization constraint).
 */
function buildUnknowns(disagreements, developerCanonical, cityCanonical, sourceRecordInconsistency) {
  const unknowns = [];
  for (const d of disagreements) {
    if (d.field === "developer_or_operator" && developerCanonical) continue;
    if (d.field === "city" && cityCanonical) continue;
    unknowns.push(
      `Contributing reports disagree on ${d.field.replace(/_/g, " ")} (${d.values.join(" / ")}) — left unresolved for curator review.`,
    );
  }
  if (sourceRecordInconsistency?.flagged) {
    unknowns.push(
      `Contributing reports grouped under this NHTSA Same Incident ID contain materially inconsistent descriptions across ${sourceRecordInconsistency.fields.length} event-shape fields (${sourceRecordInconsistency.fields.join(", ")}). WBA preserves this source-record inconsistency without determining which description is correct or whether the source grouping represents one or multiple physical events.`,
    );
  }
  return unknowns;
}

/**
 * Reconstruct each candidate's contributing `reports` array from its own
 * `_contributingReportKeys` — identical pattern to
 * `scale-up-eval/select-sample.mjs`'s `reportsFor()`, since
 * `buildCandidates()` does not carry the raw reports alongside its
 * consolidated candidate output.
 */
function buildReportLookup(allReports) {
  const byKey = new Map();
  for (const r of allReports) {
    byKey.set(`${r.reporting_generation}::${r.report_id}`, r);
  }
  return (candidate) =>
    candidate._contributingReportKeys.map((k) => byKey.get(`${k.reporting_generation}::${k.report_id}`));
}

function runOne(candidate, reportsFor) {
  const reports = reportsFor(candidate);
  const { atoms, disagreements, sourceRecordInconsistency } = extractEvidence(candidate, reports);
  const classification = classify(atoms, disagreements);

  const developerAliasAtom = atoms.find((a) => a.field === "developer_or_operator_canonical");
  const cityAliasAtom = atoms.find((a) => a.field === "city_canonical");
  const locationPrecisionAtom = atoms.find((a) => a.field === "location_precision");
  const unknowns = buildUnknowns(
    disagreements,
    developerAliasAtom?.value ?? null,
    cityAliasAtom?.value ?? null,
    sourceRecordInconsistency,
  );

  // Same draft shape validateDraft() already expects (see
  // scale-up-eval/run-scale-up.mjs) — run the frozen validator UNCHANGED,
  // as a pre-condition before this candidate is ever mapped to a WBA event.
  const draft = {
    candidateId: candidateIdentityKey(candidate),
    sameIncidentId: candidate.same_incident_id,
    atoms,
    disagreements,
    sourceRecordInconsistency,
    classification,
    locationPrecision: locationPrecisionAtom?.value ?? "unknown",
    developerCanonical: developerAliasAtom?.value ?? null,
    cityCanonical: cityAliasAtom?.value ?? null,
    unknowns,
  };
  const validation = validateDraft(draft);

  const wbaRecord = mapCandidateToWbaRecords({ candidate, reports, atoms, classification, unknowns });

  // Whether `unknowns` correctly captures every disagreement/inconsistency
  // the frozen pipeline detected is a NORMALIZATION-POLICY question —
  // validateDraft() rule 8 already checks exactly that, against every
  // candidate, before it ever reaches this generator. Re-deriving
  // buildUnknowns()'s own skip logic here (developer/city alias resolution)
  // would duplicate that policy in a second place, able to drift from it.
  // The mapping layer's own job is narrower: did mapCandidateToEvent's
  // straight copy actually preserve the ALREADY-COMPUTED `unknowns` array
  // unchanged? `normalizedUnknowns` is kept only so qa-checks.mjs can assert
  // exactly that — a carry-forward equality check, not a policy re-check.
  return { wbaRecord, validation, normalizedUnknowns: unknowns };
}

function main() {
  const { grouped, singletonCandidates, allReports } = runPipeline();
  const allCandidates = [...grouped, ...singletonCandidates];
  const reportsFor = buildReportLookup(allReports);

  const wbaRecords = [];
  const qaInputRecords = [];
  const problems = [];

  for (const candidate of allCandidates) {
    const { wbaRecord, validation, normalizedUnknowns } = runOne(candidate, reportsFor);
    if (!validation.ok) {
      problems.push({
        candidateId: wbaRecord.candidateId,
        sameIncidentId: wbaRecord.sameIncidentId,
        reason: "frozen validateDraft() reported violations",
        violations: validation.violations,
      });
      continue; // do not map a candidate the frozen validator itself rejects
    }
    wbaRecords.push(wbaRecord);
    qaInputRecords.push({ ...wbaRecord, _normalizedUnknowns: normalizedUnknowns });
  }

  const jsonlContent = wbaRecords.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(OUTPUT_JSONL, jsonlContent);
  const contentSha256 = createHash("sha256").update(jsonlContent).digest("hex");

  const qa = runFullCorpusQa({
    totalCandidatesProcessed: allCandidates.length,
    wbaRecords: qaInputRecords,
    validationFailureCount: problems.length,
  });
  for (const p of qa.problemRecords) problems.push(p);
  qa.summary.primaryOutputSha256 = contentSha256;
  qa.summary.generationBatchDate = GENERATION_BATCH_DATE;

  writeFileSync(QA_SUMMARY_PATH, JSON.stringify(qa.summary, null, 2) + "\n");
  writeFileSync(PROBLEMS_PATH, problems.map((p) => JSON.stringify(p)).join("\n") + (problems.length ? "\n" : ""));

  console.log(`Processed ${allCandidates.length} candidates.`);
  console.log(`Generated ${wbaRecords.length} event objects (${problems.length} problem(s)).`);
  console.log(`Primary output sha256: ${contentSha256}`);
  console.log(`Wrote ${OUTPUT_JSONL}, ${QA_SUMMARY_PATH}, ${PROBLEMS_PATH}`);
}

main();

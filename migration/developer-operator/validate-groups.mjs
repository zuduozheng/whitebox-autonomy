#!/usr/bin/env node
/**
 * Reproducible validation for the canonical Developer/operator grouping
 * (src/lib/events/developer-operator.ts) against the frozen audit snapshot
 * (developer-operator-snapshot.json — every distinct public
 * `developer_or_operator` value + event count, captured via full pagination
 * against the live database on 2026-09-10; see the audit report for the
 * fetch method).
 *
 * Checks, against the REAL module (not a duplicated copy of the data):
 *   - every raw value in the snapshot is covered exactly once, by a group
 *     or by EXCLUDED_DEVELOPER_RAW_VALUES (no gaps, no double-coverage);
 *   - no group lists a raw value that isn't actually present in the corpus
 *     (catches a typo that would otherwise silently sit as dead weight);
 *   - reports the canonical option count and the event-count total per
 *     canonical operator, so the numbers in the audit report stay
 *     checkable against this file rather than only against prose.
 *
 * Run: node migration/developer-operator/validate-groups.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DEVELOPER_OPERATOR_GROUPS,
  EXCLUDED_DEVELOPER_RAW_VALUES,
} from "../../src/lib/events/developer-operator.ts";

const snapshot = JSON.parse(
  readFileSync(fileURLToPath(new URL("./developer-operator-snapshot.json", import.meta.url)), "utf8"),
);
const countByRaw = new Map(snapshot.map((row) => [row.developer_or_operator, row.count]));
const distinctRaw = [...countByRaw.keys()];

const seen = new Map(); // raw -> "canonical:<label>" | "excluded"
for (const group of DEVELOPER_OPERATOR_GROUPS) {
  for (const raw of group.rawValues) {
    if (seen.has(raw)) {
      throw new Error(`Raw value ${JSON.stringify(raw)} appears in more than one group`);
    }
    seen.set(raw, `canonical:${group.canonical}`);
  }
}
for (const raw of EXCLUDED_DEVELOPER_RAW_VALUES) {
  if (seen.has(raw)) throw new Error(`Excluded value ${JSON.stringify(raw)} also appears in a group`);
  seen.set(raw, "excluded");
}

const missing = distinctRaw.filter((raw) => !seen.has(raw));
const extra = [...seen.keys()].filter((raw) => !countByRaw.has(raw));

console.log(`Snapshot distinct raw values: ${distinctRaw.length}`);
console.log(`Raw values covered by groups/exclusions: ${seen.size}`);
console.log(`Canonical groups: ${DEVELOPER_OPERATOR_GROUPS.length}`);
console.log(`Excluded raw values: ${EXCLUDED_DEVELOPER_RAW_VALUES.size}`);
console.log(`Proposed dropdown option count: ${DEVELOPER_OPERATOR_GROUPS.length}`);
console.log();

if (missing.length > 0) {
  console.error("MISSING — present in the live corpus, not covered by any group or exclusion:");
  for (const raw of missing) console.error(`  ${JSON.stringify(raw)} (${countByRaw.get(raw)} events)`);
}
if (extra.length > 0) {
  console.error("EXTRA — listed in the mapping but not present in the snapshot (check for a typo):");
  for (const raw of extra) console.error(`  ${JSON.stringify(raw)}`);
}
if (missing.length > 0 || extra.length > 0) {
  process.exitCode = 1;
} else {
  console.log("OK: complete 1:1 coverage, no duplicates, no unmatched entries.");
}

console.log();
console.log("Event count per canonical operator:");
const byCanonical = [...DEVELOPER_OPERATOR_GROUPS]
  .map((group) => ({
    canonical: group.canonical,
    rawValues: group.rawValues.length,
    events: group.rawValues.reduce((sum, raw) => sum + (countByRaw.get(raw) ?? 0), 0),
  }))
  .sort((a, b) => b.events - a.events);
for (const row of byCanonical) {
  console.log(`  ${row.events.toString().padStart(5)}  ${row.canonical} (${row.rawValues} raw value${row.rawValues === 1 ? "" : "s"})`);
}
const totalCovered = byCanonical.reduce((sum, row) => sum + row.events, 0);
const totalExcluded = [...EXCLUDED_DEVELOPER_RAW_VALUES].reduce((sum, raw) => sum + (countByRaw.get(raw) ?? 0), 0);
console.log(`  ${totalExcluded.toString().padStart(5)}  (excluded from dropdown)`);
console.log(`Total: ${totalCovered + totalExcluded} (snapshot total: ${snapshot.reduce((s, r) => s + r.count, 0)})`);

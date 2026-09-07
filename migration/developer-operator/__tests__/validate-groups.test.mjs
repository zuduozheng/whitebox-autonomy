/**
 * Regression coverage for the canonical Developer/operator grouping: proves
 * the mapping in src/lib/events/developer-operator.ts still has complete,
 * duplicate-free 1:1 coverage of every distinct raw value known at audit
 * time (developer-operator-snapshot.json), and spot-checks the specific
 * approved decisions from the audit review.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DEVELOPER_OPERATOR_GROUPS,
  EXCLUDED_DEVELOPER_RAW_VALUES,
  canonicalDeveloperLabel,
  rawValuesForCanonicalDeveloper,
  resolveCanonicalDeveloperParam,
} from "../../../src/lib/events/developer-operator.ts";

const snapshot = JSON.parse(
  readFileSync(fileURLToPath(new URL("../developer-operator-snapshot.json", import.meta.url)), "utf8"),
);
const distinctRaw = snapshot.map((row) => row.developer_or_operator);
const canonicalOptions = DEVELOPER_OPERATOR_GROUPS.map((g) => g.canonical);

test("every distinct raw value from the audit snapshot is covered exactly once", () => {
  const seen = new Map();
  for (const group of DEVELOPER_OPERATOR_GROUPS) {
    for (const raw of group.rawValues) {
      assert.equal(seen.has(raw), false, `"${raw}" appears in more than one group`);
      seen.set(raw, group.canonical);
    }
  }
  for (const raw of EXCLUDED_DEVELOPER_RAW_VALUES) {
    assert.equal(seen.has(raw), false, `"${raw}" is both excluded and in a group`);
    seen.set(raw, "excluded");
  }
  for (const raw of distinctRaw) {
    assert.equal(seen.has(raw), true, `"${raw}" is present in the corpus but not covered`);
  }
  assert.equal(seen.size, distinctRaw.length);
});

test("no group or exclusion lists a raw value absent from the audit snapshot (catches typos)", () => {
  const allListed = [
    ...DEVELOPER_OPERATOR_GROUPS.flatMap((g) => g.rawValues),
    ...EXCLUDED_DEVELOPER_RAW_VALUES,
  ];
  for (const raw of allListed) {
    assert.ok(distinctRaw.includes(raw), `"${raw}" is not a real value in the audit snapshot`);
  }
});

test("proposed canonical option count is 39", () => {
  assert.equal(DEVELOPER_OPERATOR_GROUPS.length, 39);
});

test("exactly one raw value is excluded from the dropdown (Internal employee)", () => {
  assert.deepEqual([...EXCLUDED_DEVELOPER_RAW_VALUES], ["Internal employee"]);
});

test("canonicalDeveloperLabel groups every approved Waymo variant", () => {
  for (const raw of ["Waymo", "Waymo LLC", "WAYMO LLC", "Waymo LLc", "Waymo LLlC"]) {
    assert.equal(canonicalDeveloperLabel(raw), "Waymo");
  }
});

test("canonicalDeveloperLabel groups every approved Tesla/Cruise/Zoox/Avride variant", () => {
  assert.equal(canonicalDeveloperLabel("Tesla"), "Tesla");
  assert.equal(canonicalDeveloperLabel("Tesla Inc"), "Tesla");
  assert.equal(canonicalDeveloperLabel("Cruise"), "Cruise");
  assert.equal(canonicalDeveloperLabel("CRUISE"), "Cruise");
  assert.equal(canonicalDeveloperLabel("Cruise LLC"), "Cruise");
  assert.equal(canonicalDeveloperLabel("Zoox"), "Zoox");
  assert.equal(canonicalDeveloperLabel("Zoox Inc."), "Zoox");
  assert.equal(canonicalDeveloperLabel("Zoox, Inc"), "Zoox");
  assert.equal(canonicalDeveloperLabel("Avride"), "Avride");
  assert.equal(canonicalDeveloperLabel("Avride INC."), "Avride");
});

test("\"Zoox and Waymo\" is its own canonical option, never folded into Zoox or Waymo", () => {
  assert.equal(canonicalDeveloperLabel("Zoox and Waymo"), "Zoox and Waymo");
  assert.notEqual(canonicalDeveloperLabel("Zoox and Waymo"), "Zoox");
  assert.notEqual(canonicalDeveloperLabel("Zoox and Waymo"), "Waymo");
  assert.deepEqual(rawValuesForCanonicalDeveloper("Zoox and Waymo"), ["Zoox and Waymo"]);
});

test("\"Internal employee\" has no canonical label reachable from the dropdown", () => {
  assert.equal(canonicalOptions.includes("Internal employee"), false);
  // canonicalDeveloperLabel is still well-defined for it (identity fallback,
  // since it's never in any group) — it's just never offered as an option.
  assert.equal(canonicalDeveloperLabel("Internal employee"), "Internal employee");
});

test("Hyundai Motor America and Kia America remain distinct canonical options", () => {
  assert.equal(canonicalDeveloperLabel("Hyundai Motor America"), "Hyundai Motor America");
  assert.equal(canonicalDeveloperLabel("Kia America, Inc."), "Kia America");
  assert.notEqual(canonicalDeveloperLabel("Hyundai Motor America"), canonicalDeveloperLabel("Kia America, Inc."));
});

test("Stack AV and Argo AI remain distinct canonical options", () => {
  assert.equal(canonicalDeveloperLabel("Stack AV Co."), "Stack AV");
  assert.equal(canonicalDeveloperLabel("Argo AI"), "Argo AI");
  assert.notEqual(canonicalDeveloperLabel("Stack AV Co."), canonicalDeveloperLabel("Argo AI"));
});

test("ADMT/VWGoA merge includes the reordered variant; Mercedes R&D trio merges into one label", () => {
  assert.equal(canonicalDeveloperLabel("VWGoA- ADMT"), "ADMT / VWGoA");
  assert.equal(canonicalDeveloperLabel("ADMT - VWGoA"), "ADMT / VWGoA");
  for (const raw of [
    "Mercedes-Benz RD NA",
    "Mercedes-Benz Research and Development NA",
    "Mercedes-Benz Research and Development North America",
  ]) {
    assert.equal(canonicalDeveloperLabel(raw), "Mercedes-Benz R&D North America");
  }
});

test("legal-suffix stripping matches the approved examples", () => {
  assert.equal(canonicalDeveloperLabel("Apple Inc."), "Apple");
  assert.equal(canonicalDeveloperLabel("AutoX Technologies, Inc."), "AutoX Technologies");
  assert.equal(canonicalDeveloperLabel("First Transit, Inc."), "First Transit");
  assert.equal(canonicalDeveloperLabel("Gatik AI Inc."), "Gatik AI");
  assert.equal(canonicalDeveloperLabel("Ghost Autonomy Inc."), "Ghost Autonomy");
  assert.equal(canonicalDeveloperLabel("Lucid USA, Inc."), "Lucid");
  assert.equal(canonicalDeveloperLabel("Navistar, Inc."), "Navistar");
  assert.equal(canonicalDeveloperLabel("VinFast Auto, LLC"), "VinFast");
});

test("a raw value with no explicit mapping falls back to identity, never guessed into a group", () => {
  assert.equal(canonicalDeveloperLabel("Some Brand New Filer LLC"), "Some Brand New Filer LLC");
});

test("rawValuesForCanonicalDeveloper returns the complete set for a merged group", () => {
  assert.deepEqual(
    [...rawValuesForCanonicalDeveloper("Waymo")].sort(),
    ["WAYMO LLC", "Waymo", "Waymo LLC", "Waymo LLc", "Waymo LLlC"].sort(),
  );
});

test("resolveCanonicalDeveloperParam accepts a current canonical value", () => {
  assert.equal(resolveCanonicalDeveloperParam("Waymo", canonicalOptions), "Waymo");
});

test("resolveCanonicalDeveloperParam resolves an old raw-value URL for backward compatibility", () => {
  assert.equal(resolveCanonicalDeveloperParam("Waymo LLC", canonicalOptions), "Waymo");
  assert.equal(resolveCanonicalDeveloperParam("WAYMO LLC", canonicalOptions), "Waymo");
});

test("resolveCanonicalDeveloperParam rejects an unknown value", () => {
  assert.equal(resolveCanonicalDeveloperParam("Not A Real Value", canonicalOptions), undefined);
});

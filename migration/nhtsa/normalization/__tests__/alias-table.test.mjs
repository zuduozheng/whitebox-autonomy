/**
 * Focused regression tests for the Step 5 alias-table whitespace-fold fix
 * (targeted adversarial stress test, case 58ed5a4d4e93504).
 *
 * Run with: node --test migration/nhtsa/normalization/__tests__
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveDeveloperAlias } from "../alias-table.mjs";

test("Kodiak comma-adjacent-whitespace variant now resolves (the reproduced bug)", () => {
  const result = resolveDeveloperAlias(null, ["Kodiak Robotics, Inc", "Kodiak Robotics,Inc."]);
  assert.equal(result.resolved, true);
  assert.equal(result.reason.includes("cosmetic"), true);
});

test("still resolves the previously-working trailing-period variant (no regression)", () => {
  const result = resolveDeveloperAlias(null, ["Waymo LLC.", "Waymo LLC"]);
  assert.equal(result.resolved, true);
});

test("still resolves hyphen-vs-space variant (no regression)", () => {
  const result = resolveDeveloperAlias(null, ["Kodiak-Robotics, Inc.", "Kodiak Robotics, Inc"]);
  assert.equal(result.resolved, true);
});

test("still refuses a genuine different-word-count entity difference (no over-fix)", () => {
  const result = resolveDeveloperAlias(null, ["NVIDIA Corporation", "NVIDIA"]);
  assert.equal(result.resolved, false);
});

test("still refuses a genuine different-word-count entity difference (Motional)", () => {
  const result = resolveDeveloperAlias(null, ["Motional", "Motional AD Inc."]);
  assert.equal(result.resolved, false);
});

test("still refuses a wholly different name (no fuzzy/edit-distance matching introduced)", () => {
  const result = resolveDeveloperAlias(null, ["Mercedes-Benz", "MBUS"]);
  assert.equal(result.resolved, false);
});

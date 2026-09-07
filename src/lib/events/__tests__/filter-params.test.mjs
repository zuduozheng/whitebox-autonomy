/**
 * Regression coverage for the shared Observatory/Map filter model — the URL
 * parsing and serialization both pages rely on to stay in sync (see
 * ../filter-params.ts's own doc comment), including the canonical
 * Developer/operator resolution added on top of it
 * (../developer-operator.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { parseSharedFilterParams, isSharedFilterEmpty, sharedFilterToQueryString } = await import(
  "../filter-params.ts"
);

// The canonical option list a page would have already computed from the
// live corpus (repository.ts's listDeveloperOrOperatorOptions()).
const DEVELOPER_OPTIONS = ["Tesla", "Waymo"];

test("parses all three filters when present and valid", () => {
  const filter = parseSharedFilterParams(
    { eventType: "collision", valence: "failure-or-challenging", developerOrOperator: "Waymo" },
    DEVELOPER_OPTIONS,
  );
  assert.deepEqual(filter, {
    eventType: "collision",
    valence: "failure-or-challenging",
    developerOrOperator: "Waymo",
  });
});

test("drops an eventType/valence value outside the fixed enum", () => {
  const filter = parseSharedFilterParams(
    { eventType: "not-a-real-type", valence: "also-fake" },
    DEVELOPER_OPTIONS,
  );
  assert.equal(filter.eventType, undefined);
  assert.equal(filter.valence, undefined);
});

test("drops a developerOrOperator value that isn't a current canonical option or a known raw variant", () => {
  const filter = parseSharedFilterParams({ developerOrOperator: "Not A Real Developer" }, DEVELOPER_OPTIONS);
  assert.equal(filter.developerOrOperator, undefined);
});

test("resolves an old raw-value URL to its canonical operator (backward compatibility)", () => {
  // "Waymo LLC" was a valid raw-value filter before the canonical grouping
  // existed; a URL built back then must still work.
  const filter = parseSharedFilterParams({ developerOrOperator: "Waymo LLC" }, DEVELOPER_OPTIONS);
  assert.equal(filter.developerOrOperator, "Waymo");
});

test("takes the first value when a param is repeated (array form)", () => {
  const filter = parseSharedFilterParams({ eventType: ["collision", "other"] }, DEVELOPER_OPTIONS);
  assert.equal(filter.eventType, "collision");
});

test("an empty searchParams object parses to an entirely empty filter", () => {
  const filter = parseSharedFilterParams({}, DEVELOPER_OPTIONS);
  assert.deepEqual(filter, { eventType: undefined, valence: undefined, developerOrOperator: undefined });
  assert.equal(isSharedFilterEmpty(filter), true);
});

test("sharedFilterToQueryString round-trips through parseSharedFilterParams", () => {
  const original = { eventType: "collision", valence: "failure-or-challenging", developerOrOperator: "Waymo" };
  const queryString = sharedFilterToQueryString(original);
  const reparsed = parseSharedFilterParams(Object.fromEntries(new URLSearchParams(queryString)), DEVELOPER_OPTIONS);
  assert.deepEqual(reparsed, original);
});

test("sharedFilterToQueryString is empty for an empty filter", () => {
  assert.equal(sharedFilterToQueryString({}), "");
});

test("sharedFilterToQueryString URL-encodes a canonical value with spaces", () => {
  const queryString = sharedFilterToQueryString({
    eventType: "collision",
    valence: "failure-or-challenging",
    developerOrOperator: "May Mobility",
  });
  assert.equal(queryString, "eventType=collision&valence=failure-or-challenging&developerOrOperator=May+Mobility");
  assert.equal(new URLSearchParams(queryString).get("developerOrOperator"), "May Mobility");
});

test("isSharedFilterEmpty is false when only developerOrOperator is set", () => {
  assert.equal(isSharedFilterEmpty({ developerOrOperator: "Tesla" }), false);
});

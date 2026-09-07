import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SOURCE_TYPE_OPTIONS,
  locationPrecisionLabel,
  originLabel,
  reviewStatusLabel,
  sourceTypeLabel,
} from "../labels.ts";

test("SOURCE_TYPE_OPTIONS includes regulatory-record alongside every existing type", () => {
  assert.deepEqual(SOURCE_TYPE_OPTIONS, [
    "x-post",
    "youtube-video",
    "news-article",
    "official-report",
    "regulatory-record",
    "other",
  ]);
});

test("sourceTypeLabel gives regulatory-record a clear human-readable label", () => {
  assert.equal(sourceTypeLabel("regulatory-record"), "Regulatory record");
});

test("sourceTypeLabel is unchanged for every pre-existing source type", () => {
  const expected = {
    "x-post": "X post",
    "youtube-video": "YouTube video",
    "news-article": "News article",
    "official-report": "Official report",
    "other": "Other",
  };
  for (const [type, label] of Object.entries(expected)) {
    assert.equal(sourceTypeLabel(type), label);
  }
});

test("sourceTypeLabel returns a distinct label for every option (no accidental collisions)", () => {
  const labels = SOURCE_TYPE_OPTIONS.map((option) => sourceTypeLabel(option));
  assert.equal(new Set(labels).size, labels.length);
});

test("originLabel resolves both frozen origin values, distinctly", () => {
  assert.equal(originLabel("curated"), "Curated");
  assert.equal(originLabel("source-derived"), "Source-derived");
  assert.notEqual(originLabel("curated"), originLabel("source-derived"));
});

test("originLabel's wording never collides with a reviewStatusLabel wording", () => {
  // Origin and review_status are deliberately independent dimensions — their
  // labels should never look interchangeable in the UI.
  const originLabels = ["curated", "source-derived"].map(originLabel);
  const reviewLabels = ["curator-reviewed", "verified", "disputed"].map(reviewStatusLabel);
  for (const o of originLabels) {
    assert.equal(reviewLabels.includes(o), false);
  }
});

test("locationPrecisionLabel resolves every frozen precision value, distinctly", () => {
  const values = [
    "exact-point",
    "road-or-intersection",
    "local-area",
    "city",
    "region",
    "country",
    "unknown",
  ];
  const labels = values.map(locationPrecisionLabel);
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(locationPrecisionLabel("city"), "City level");
});

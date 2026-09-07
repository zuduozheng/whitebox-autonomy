import { test } from "node:test";
import assert from "node:assert/strict";

import { generateTitle, formatOccurredOnForTitle, eventTypeLabelForTitle, EVENT_TYPE_LABELS } from "../title.mjs";

function baseEvent(overrides = {}) {
  return {
    developer_or_operator: "Waymo LLC",
    event_type: "collision",
    location_text: null,
    occurred_on: null,
    occurred_on_precision: "unknown",
    ...overrides,
  };
}

test("EVENT_TYPE_LABELS matches src/lib/events/labels.ts's EVENT_TYPE_LABELS exactly", () => {
  // This migration tooling never imports from src/ (see title.mjs's own file
  // header) so the label set is copied verbatim; this test is the tripwire
  // that catches drift if the app's own labels ever change.
  assert.deepEqual(EVENT_TYPE_LABELS, {
    "collision": "Collision",
    "near-miss-or-safety-critical": "Near miss / safety-critical interaction",
    "unexpected-or-inappropriate-behaviour": "Unexpected or inappropriate behaviour",
    "unnecessary-stop-braking-or-hesitation": "Unnecessary stop / braking / hesitation",
    "traffic-rule-or-infrastructure-interpretation": "Traffic-rule or infrastructure interpretation",
    "vulnerable-road-user-interaction": "Pedestrian / cyclist / vulnerable-road-user interaction",
    "emergency-vehicle-interaction": "Emergency-vehicle interaction",
    "traffic-disruption-or-obstruction": "Traffic disruption / obstruction",
    "successful-challenging-interaction": "Successful challenging interaction",
    "other": "Other",
  });
});

test("generateTitle: developer + event type only (no location, no date)", () => {
  assert.equal(generateTitle(baseEvent()), "Waymo LLC Collision");
});

test("generateTitle: + location", () => {
  assert.equal(
    generateTitle(baseEvent({ location_text: "Phoenix, AZ, US" })),
    "Waymo LLC Collision — Phoenix, AZ, US",
  );
});

test("generateTitle: + date (day precision)", () => {
  assert.equal(
    generateTitle(baseEvent({ occurred_on: "2024-03-17", occurred_on_precision: "day" })),
    "Waymo LLC Collision — 17 March 2024",
  );
});

test("generateTitle: + date (month precision)", () => {
  assert.equal(
    generateTitle(baseEvent({ occurred_on: "2024-03-01", occurred_on_precision: "month" })),
    "Waymo LLC Collision — March 2024",
  );
});

test("generateTitle: + date (year precision)", () => {
  assert.equal(
    generateTitle(baseEvent({ occurred_on: "2024-01-01", occurred_on_precision: "year" })),
    "Waymo LLC Collision — 2024",
  );
});

test("generateTitle: location + date together", () => {
  assert.equal(
    generateTitle(
      baseEvent({ location_text: "Phoenix, AZ, US", occurred_on: "2024-03-01", occurred_on_precision: "month" }),
    ),
    "Waymo LLC Collision — Phoenix, AZ, US — March 2024",
  );
});

test("generateTitle: unknown date precision omits the date clause entirely (never 'Date unknown')", () => {
  const title = generateTitle(
    baseEvent({ location_text: "Phoenix, AZ, US", occurred_on: null, occurred_on_precision: "unknown" }),
  );
  assert.equal(title, "Waymo LLC Collision — Phoenix, AZ, US");
  assert.equal(/unknown/i.test(title), false);
});

test("generateTitle: missing location AND missing date both omitted cleanly (no dangling separators)", () => {
  const title = generateTitle(baseEvent());
  assert.equal(title.includes("—"), false);
  assert.equal(title, "Waymo LLC Collision");
});

test("generateTitle: every event_type produces a distinct, non-throwing label", () => {
  for (const eventType of Object.keys(EVENT_TYPE_LABELS)) {
    const title = generateTitle(baseEvent({ event_type: eventType }));
    assert.equal(title, `Waymo LLC ${EVENT_TYPE_LABELS[eventType]}`);
  }
});

test("generateTitle: throws (never fabricates 'Unknown developer') when developer_or_operator is null", () => {
  assert.throws(
    () => generateTitle(baseEvent({ developer_or_operator: null })),
    /developer_or_operator is required/,
  );
});

test("generateTitle: throws (never guesses) on an event_type outside the known label set", () => {
  assert.throws(
    () => generateTitle(baseEvent({ event_type: "not-a-real-type" })),
    /is not in the known label set/,
  );
});

test("generateTitle: stable repeat output — same input always produces byte-identical output", () => {
  const event = baseEvent({ location_text: "Phoenix, AZ, US", occurred_on: "2024-03-01", occurred_on_precision: "month" });
  const first = generateTitle(event);
  for (let i = 0; i < 20; i++) {
    assert.equal(generateTitle(event), first);
  }
});

test("formatOccurredOnForTitle returns null (not a placeholder string) for unknown precision or missing date", () => {
  assert.equal(formatOccurredOnForTitle(null, "unknown"), null);
  assert.equal(formatOccurredOnForTitle(null, "day"), null);
});

test("eventTypeLabelForTitle throws on an unrecognized event_type", () => {
  assert.throws(() => eventTypeLabelForTitle("nonsense"), /is not in the known label set/);
});

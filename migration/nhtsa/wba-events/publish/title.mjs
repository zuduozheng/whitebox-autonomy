/**
 * Deterministic, restrained title generation for NHTSA source-derived
 * publication — pure functions only, no LLM, no narrative interpretation.
 *
 * Reuses the SAME semantics already established elsewhere in the app rather
 * than inventing divergent formatting rules:
 *   - the month-name table and day/month/year rendering exactly mirror
 *     src/lib/events/format.ts's formatPartialDate() (this migration tooling
 *     is a deliberately separate module tree that never imports from src/ —
 *     see build-promotion-sql.mjs / map-candidate-to-event.mjs — so the same
 *     PURE LOGIC is reproduced here rather than crossing that boundary);
 *   - the event-type wording is EVENT_TYPE_LABELS, copied verbatim from
 *     src/lib/events/labels.ts, the one existing canonical "event-type
 *     label" system already shown on every event card, the admin form, and
 *     the public event page. A mismatch between the two copies would be
 *     caught by __tests__/title.test.mjs asserting the exact expected label
 *     set.
 *
 * Pattern: "<developer_or_operator> <event-type label>[ — <location_text>][
 * — <partial date>]". Both bracketed clauses are omitted entirely (never
 * rendered as an empty or placeholder fragment) when the underlying field is
 * absent. Location text is used verbatim, never re-derived or qualified with
 * a precision suffix here — location_precision for NHTSA data never exceeds
 * "city" (see map-candidate-to-event.mjs), so location_text itself already
 * carries no more precision than the record actually supports, and the full
 * event page (Beta 1.1 Slice 1) is where location_precision is separately,
 * explicitly surfaced. occurred_on_precision similarly gates the date
 * fragment: "unknown" precision omits the date entirely rather than ever
 * printing a placeholder like "Date unknown" inside a title.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Copied verbatim from src/lib/events/labels.ts's EVENT_TYPE_LABELS. Kept as
 * a plain object (not imported) because this migration tooling never
 * imports from src/ — see file header. __tests__/title.test.mjs asserts this
 * set stays byte-identical to the app's own copy.
 */
export const EVENT_TYPE_LABELS = {
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
};

/**
 * "<day> <Month> <year>" / "<Month> <year>" / "<year>" / null — mirrors
 * formatPartialDate()'s day/month/year rendering exactly, except it returns
 * null (never a "Date unknown" placeholder string) when precision is
 * "unknown" or the date is absent, so the caller can omit the whole clause.
 */
export function formatOccurredOnForTitle(occurredOn, occurredOnPrecision) {
  if (occurredOnPrecision === "unknown" || !occurredOn) return null;
  const [year, month, day] = occurredOn.split("-");
  if (occurredOnPrecision === "year") return year;
  const monthName = MONTHS[Number(month) - 1] ?? month;
  if (occurredOnPrecision === "month") return `${monthName} ${year}`;
  return `${Number(day)} ${monthName} ${year}`;
}

/** Throws on an event_type outside the known label set — never silently guesses. */
export function eventTypeLabelForTitle(eventType) {
  const label = EVENT_TYPE_LABELS[eventType];
  if (label === undefined) {
    throw new Error(`generateTitle: event_type "${eventType}" is not in the known label set`);
  }
  return label;
}

/**
 * Pure: same `event` shape always produces the byte-identical title.
 *
 * `event` must already have passed precondition evaluation
 * (preconditions.mjs) — developer_or_operator and event_type are required
 * here and this function throws if either is missing, rather than silently
 * falling back to a placeholder like "Unknown developer". Callers must
 * exclude a record from publication entirely (never call this function on
 * it) if preconditions failed; this function is not itself the gate.
 */
export function generateTitle(event) {
  if (!event.developer_or_operator) {
    throw new Error("generateTitle: developer_or_operator is required (null/empty is not publishable)");
  }
  const label = eventTypeLabelForTitle(event.event_type);

  const parts = [`${event.developer_or_operator} ${label}`];
  if (event.location_text) parts.push(event.location_text);

  const dateText = formatOccurredOnForTitle(event.occurred_on, event.occurred_on_precision);
  if (dateText) parts.push(dateText);

  return parts.join(" — ");
}

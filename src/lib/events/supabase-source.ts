/**
 * Supabase-backed event source.
 *
 * The remote counterpart of ./local-source.ts: it implements the same
 * `loadEvents(): Promise<Event[]>` contract, so `repository.ts` is the ONLY
 * file that changes when the Observatory switches from the in-repo seed to
 * PostgreSQL.
 *
 * Import boundary: this module must be imported ONLY by `repository.ts`.
 * Pages and UI components import from `repository.ts` (and `./types` /
 * `./labels`) and never touch Supabase directly.
 *
 * Access model: read-only and public. It uses the project's publishable
 * ("anon") key and reads strictly through the existing Row-Level Security
 * policies (SELECT on `is_public` rows only). No service-role key, no writes,
 * no schema or policy knowledge beyond the two table names.
 *
 * Rows are mapped back into the exact TypeScript `Event` shape used everywhere
 * else. Anything that violates that shape (bad enum value, a "known" date
 * precision with no date, an event with no sources, …) throws with a clear
 * message rather than being coerced into a misleading value.
 */

import { createClient } from "@supabase/supabase-js";

import type {
  AutomationStatus,
  Causation,
  CausationStatus,
  Event,
  EventLocation,
  EventType,
  LocationPrecision,
  Origin,
  PartialDate,
  ReviewStatus,
  Source,
  SourceType,
  SystemVersion,
  Valence,
} from "./types";

// --- environment ----------------------------------------------------------
// Fail fast if the public read configuration is absent. The app never falls
// back to the local seed when Supabase is the active source.
const RAW_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!RAW_SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  const missing = [
    !RAW_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
    !SUPABASE_PUBLISHABLE_KEY && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]
    .filter(Boolean)
    .join(", ");
  throw new Error(
    `Supabase event source is not configured: missing ${missing}. ` +
      "Copy .env.example to .env.local and set the project URL and publishable " +
      "key (Supabase dashboard -> Project Settings -> API). The app does not " +
      "fall back to the local seed.",
  );
}

// supabase-js wants the bare project origin and appends "/rest/v1" itself.
// Tolerate a value that already carries the REST path (a common copy/paste).
const SUPABASE_URL = RAW_SUPABASE_URL.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
if (SUPABASE_URL !== RAW_SUPABASE_URL.replace(/\/+$/, "")) {
  console.warn(
    "[supabase-source] NEXT_PUBLIC_SUPABASE_URL includes a /rest/v1 path; " +
      "using the project origin only. Set it to the bare project URL to silence this.",
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// One round trip: every readable event with its sources embedded through the
// event_source.event_id -> event.id foreign key.
const EVENT_SELECT = `
  slug,
  title,
  summary,
  occurred_on,
  occurred_on_precision,
  location_text,
  location_country_code,
  location_precision,
  developer_or_operator,
  system_name,
  automation_status,
  system_version,
  system_version_knowledge,
  event_type,
  valence,
  observed_facts,
  unknowns,
  interpretation,
  causation_status,
  causation_note,
  review_status,
  origin,
  record_updated,
  sources:event_source (
    url,
    source_type,
    publisher,
    label,
    published_on,
    published_on_precision,
    retrieved_on,
    note
  )
`;

// --- shapes returned by PostgREST (snake_case, nullable) -----------------
interface EventSourceRow {
  url: string | null;
  source_type: string | null;
  publisher: string | null;
  label: string | null;
  published_on: string | null;
  published_on_precision: string | null;
  retrieved_on: string | null;
  note: string | null;
}

interface EventRow {
  slug: string | null;
  title: string | null;
  summary: string | null;
  occurred_on: string | null;
  occurred_on_precision: string | null;
  location_text: string | null;
  location_country_code: string | null;
  location_precision: string | null;
  developer_or_operator: string | null;
  system_name: string | null;
  automation_status: string | null;
  system_version: string | null;
  system_version_knowledge: string | null;
  event_type: string | null;
  valence: string | null;
  observed_facts: string[] | null;
  unknowns: string[] | null;
  interpretation: string | null;
  causation_status: string | null;
  causation_note: string | null;
  review_status: string | null;
  origin: string | null;
  record_updated: string | null;
  sources: EventSourceRow[] | null;
}

// --- controlled vocabularies (type-checked against ./types) --------------
const AUTOMATION_STATUSES = [
  "driving-automation-engaged-confirmed",
  "driving-automation-engaged-reported",
  "driving-automation-status-uncertain",
  "driving-automation-not-engaged",
  "unknown",
] as const satisfies readonly AutomationStatus[];

const EVENT_TYPES = [
  "collision",
  "near-miss-or-safety-critical",
  "unexpected-or-inappropriate-behaviour",
  "unnecessary-stop-braking-or-hesitation",
  "traffic-rule-or-infrastructure-interpretation",
  "vulnerable-road-user-interaction",
  "emergency-vehicle-interaction",
  "traffic-disruption-or-obstruction",
  "successful-challenging-interaction",
  "other",
] as const satisfies readonly EventType[];

const VALENCES = [
  "failure-or-challenging",
  "successful-handling",
  "neutral-or-unclear",
] as const satisfies readonly Valence[];

const CAUSATION_STATUSES = [
  "undetermined",
  "automation-system-contributed",
  "other-party-contributed",
  "shared-or-multiple-factors",
  "not-applicable",
] as const satisfies readonly CausationStatus[];

const REVIEW_STATUSES = [
  "curator-reviewed",
  "verified",
  "disputed",
] as const satisfies readonly ReviewStatus[];

const ORIGINS = ["curated", "source-derived"] as const satisfies readonly Origin[];

const LOCATION_PRECISIONS = [
  "exact-point",
  "road-or-intersection",
  "local-area",
  "city",
  "region",
  "country",
  "unknown",
] as const satisfies readonly LocationPrecision[];

const SOURCE_TYPES = [
  "x-post",
  "youtube-video",
  "news-article",
  "official-report",
  "regulatory-record",
  "other",
] as const satisfies readonly SourceType[];

const VERSION_KNOWLEDGE = ["stated", "approximate", "unknown"] as const;
type VersionKnowledge = (typeof VERSION_KNOWLEDGE)[number];

const DATE_PRECISIONS = ["day", "month", "year", "unknown"] as const;
type DatePrecision = (typeof DATE_PRECISIONS)[number];

// --- field mappers (each throws on anything the Event model disallows) ---
function req(value: string | null | undefined, field: string, slug: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Event "${slug}": missing or empty "${field}"`);
  }
  return value;
}

function oneOf<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  field: string,
  slug: string,
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(
    `Event "${slug}": "${field}" has unexpected value ${JSON.stringify(value)}; ` +
      `expected one of ${allowed.join(", ")}`,
  );
}

/**
 * (date, precision) -> PartialDate. `unknown` precision must have a null date
 * and yields `{ value: "", precision: "unknown" }`; a day/month/year precision
 * must have a date, trimmed to the stated granularity.
 */
function toPartialDate(
  date: string | null,
  precision: string | null,
  field: string,
  slug: string,
): PartialDate {
  const p = oneOf<DatePrecision>(precision, DATE_PRECISIONS, `${field}_precision`, slug);
  if (p === "unknown") {
    if (date !== null) {
      throw new Error(`Event "${slug}": "${field}" precision is "unknown" but a date is set`);
    }
    return { value: "", precision: "unknown" };
  }
  if (!date) {
    throw new Error(`Event "${slug}": "${field}" precision is "${p}" but no date is set`);
  }
  const value = p === "year" ? date.slice(0, 4) : p === "month" ? date.slice(0, 7) : date;
  return { value, precision: p };
}

function toSystemVersion(
  value: string | null,
  knowledge: string | null,
  slug: string,
): SystemVersion {
  const k = oneOf<VersionKnowledge>(
    knowledge,
    VERSION_KNOWLEDGE,
    "system_version_knowledge",
    slug,
  );
  if (value === null) {
    return { knowledge: k };
  }
  if (k === "unknown") {
    throw new Error(
      `Event "${slug}": "system_version" is set but "system_version_knowledge" is "unknown"`,
    );
  }
  return { value, knowledge: k };
}

function toCausation(status: string | null, note: string | null, slug: string): Causation {
  const s = oneOf<CausationStatus>(status, CAUSATION_STATUSES, "causation_status", slug);
  return note === null ? { status: s } : { status: s, note };
}

function toLocation(
  text: string | null,
  countryCode: string | null,
  precision: string | null,
  slug: string,
): EventLocation | undefined {
  if (text === null) {
    if (countryCode !== null) {
      throw new Error(
        `Event "${slug}": location_country_code is set without location_text`,
      );
    }
    return undefined;
  }
  const p = oneOf<LocationPrecision>(precision, LOCATION_PRECISIONS, "location_precision", slug);
  return countryCode === null ? { text, precision: p } : { text, countryCode, precision: p };
}

function toStringArray(value: string[] | null, field: string, slug: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Event "${slug}": "${field}" must be a non-empty array`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(`Event "${slug}": "${field}" contains an empty or non-string entry`);
    }
  }
  return value;
}

/**
 * Like `toStringArray`, but an empty array is a legitimate value. Used for
 * `unknowns` on every event (a public event may genuinely have nothing left
 * unestablished), and for `observed_facts` on a `source-derived` event only
 * (its structured/classified fields and sources carry the evidence instead of
 * curator-written bullets — see 20260908000000_event_origin.sql). A `curated`
 * event's `observed_facts` still goes through `toStringArray` and stays
 * mandatory.
 */
function toOptionalStringArray(value: string[] | null, field: string, slug: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Event "${slug}": "${field}" must be an array`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(`Event "${slug}": "${field}" contains an empty or non-string entry`);
    }
  }
  return value;
}

function toSource(row: EventSourceRow, slug: string): Source {
  const source: Source = {
    url: req(row.url, "source.url", slug),
    type: oneOf<SourceType>(row.source_type, SOURCE_TYPES, "source.source_type", slug),
  };
  if (row.publisher !== null) source.publisher = req(row.publisher, "source.publisher", slug);
  if (row.label !== null) source.label = req(row.label, "source.label", slug);
  if (row.published_on !== null || row.published_on_precision !== "unknown") {
    source.publishedOn = toPartialDate(
      row.published_on,
      row.published_on_precision,
      "source.published_on",
      slug,
    );
  }
  if (row.retrieved_on !== null) source.retrievedOn = row.retrieved_on;
  if (row.note !== null) source.note = req(row.note, "source.note", slug);
  return source;
}

function toEvent(row: EventRow): Event {
  const slug = req(row.slug, "slug", row.slug ?? "(unknown)");
  const origin = oneOf<Origin>(row.origin, ORIGINS, "origin", slug);

  const sourceRows = Array.isArray(row.sources) ? row.sources : [];
  if (sourceRows.length === 0) {
    throw new Error(`Event "${slug}": no sources returned from the database`);
  }

  const event: Event = {
    slug,
    title: req(row.title, "title", slug),
    // A curated event's summary stays mandatory (req throws on null); a
    // source-derived event may genuinely have none (20260908000000_event_
    // origin.sql) — never a fabricated placeholder.
    summary: row.summary !== null ? req(row.summary, "summary", slug) : null,
    occurredOn: toPartialDate(row.occurred_on, row.occurred_on_precision, "occurred_on", slug),
    developerOrOperator: req(row.developer_or_operator, "developer_or_operator", slug),
    automationStatus: oneOf<AutomationStatus>(
      row.automation_status,
      AUTOMATION_STATUSES,
      "automation_status",
      slug,
    ),
    systemVersion: toSystemVersion(row.system_version, row.system_version_knowledge, slug),
    eventType: oneOf<EventType>(row.event_type, EVENT_TYPES, "event_type", slug),
    valence: oneOf<Valence>(row.valence, VALENCES, "valence", slug),
    // A curated event's observed_facts stays mandatory (>=1); a source-derived
    // event may legitimately publish with none — its structured/classified
    // fields and sources carry the evidence instead. Never manufactured here.
    observedFacts:
      origin === "source-derived"
        ? toOptionalStringArray(row.observed_facts, "observed_facts", slug)
        : toStringArray(row.observed_facts, "observed_facts", slug),
    unknowns: toOptionalStringArray(row.unknowns, "unknowns", slug),
    causation: toCausation(row.causation_status, row.causation_note, slug),
    // A curated event's review_status stays mandatory; a source-derived event
    // may have none yet, or may later genuinely acquire one without its
    // origin changing (see types.ts's ReviewStatus/Origin doc comments).
    reviewStatus:
      row.review_status !== null
        ? oneOf<ReviewStatus>(row.review_status, REVIEW_STATUSES, "review_status", slug)
        : null,
    origin,
    recordUpdated: req(row.record_updated, "record_updated", slug),
    sources: sourceRows.map((source) => toSource(source, slug)),
  };

  const location = toLocation(row.location_text, row.location_country_code, row.location_precision, slug);
  if (location) event.location = location;
  if (row.system_name !== null) {
    event.systemName = req(row.system_name, "system_name", slug);
  }
  if (row.interpretation !== null) {
    event.interpretation = req(row.interpretation, "interpretation", slug);
  }

  return event;
}

/**
 * Load-time invariants — mirrors ./local-source.ts so both sources agree,
 * except the observed_facts check below, which ./local-source.ts's fixed,
 * hand-authored dataset has no need for: every event it describes is
 * `curated` origin, so its own unconditional check already agrees with the
 * `origin === "curated"` case here in every case that ever actually occurs
 * there.
 */
function assertInvariants(events: Event[]): void {
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.slug)) {
      throw new Error(`Duplicate event slug: "${event.slug}"`);
    }
    seen.add(event.slug);

    // A source-derived event may legitimately have no observed_facts — see
    // 20260908000000_event_origin.sql and toEvent()'s own mapping above.
    if (event.origin === "curated" && event.observedFacts.length === 0) {
      throw new Error(`Event "${event.slug}" has no observedFacts`);
    }
    // unknowns is deliberately NOT checked here: an empty array is a
    // legitimate value — a well-evidenced event can have nothing left
    // unestablished. See 20260904000000_unknowns_optional_for_publication.sql.
    if (event.sources.length === 0) {
      throw new Error(`Event "${event.slug}" has no sources`);
    }
    if (!event.recordUpdated) {
      throw new Error(`Event "${event.slug}" has no recordUpdated date`);
    }
  }
}

/**
 * Supabase/PostgREST caps an unpaginated `select()` at a server-side default
 * of 1000 rows — silent (HTTP 206, no error) unless the caller notices the
 * row count. This project's corpus stayed under that cap through every prior
 * milestone; the NHTSA publication (2837 events, 2923 public events total)
 * crossed it, which is how this was found. Matches the server's own cap
 * exactly, per PostgREST's `.range()` convention: inclusive, zero-indexed.
 */
export const EVENT_PAGE_SIZE = 1000;

/** One page of raw `event` rows, ordered by slug ascending, offset-based. */
async function fetchEventPage(offset: number): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from("event")
    .select(EVENT_SELECT)
    .order("slug", { ascending: true })
    .range(offset, offset + EVENT_PAGE_SIZE - 1);

  if (error) {
    throw new Error(
      `Failed to load events from Supabase (${error.code ?? "no code"}): ${error.message}`,
    );
  }
  if (!data) {
    throw new Error("Supabase returned no data for the event query");
  }
  return data as unknown as EventRow[];
}

/**
 * Loads the COMPLETE public event corpus, paginating past PostgREST's
 * default row cap. `slug` is unique and NOT NULL (20260829235332's `slug
 * text not null unique`), so ordering by it ascending gives a stable total
 * order — consecutive, non-overlapping `.range()` windows over that order
 * can neither skip nor duplicate a row under a static table. A page
 * strictly shorter than EVENT_PAGE_SIZE is the only completion signal (never
 * an assumed total count): the same signal a single unpaginated call would
 * have used it to look complete before this fix existed.
 *
 * A failure on any page — including a later one — rejects the whole call
 * without returning the earlier pages already fetched: `rows` only feeds
 * `toEvent`/`assertInvariants` after every page has succeeded, so a partial
 * corpus can never be silently observed by a caller. `assertInvariants`
 * (unchanged) already rejects a duplicate slug across the FULL combined
 * result, which is exactly the boundary this pagination could otherwise get
 * wrong (double-counting a row across two pages) — no extra cross-page
 * dedup check was added here because that one already covers it.
 */
export async function loadEvents(): Promise<Event[]> {
  const rows: EventRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchEventPage(offset);
    rows.push(...page);
    if (page.length < EVENT_PAGE_SIZE) break;
    offset += EVENT_PAGE_SIZE;
  }

  const events = rows.map(toEvent);
  assertInvariants(events);
  return events;
}

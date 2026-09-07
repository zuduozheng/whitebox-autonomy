/**
 * Admin event form — shared, side-effect-free logic used by both the client
 * form component and the server actions.
 *
 * Contains NO database access, NO secrets and NO server-only imports, so it is
 * safe to import from a Client Component. Parsing/validation of the submitted
 * FormData happens here and is re-run authoritatively inside the server action;
 * the browser is never trusted.
 *
 * The write model here is intentionally separate from the public read `Event`
 * type in src/lib/events/types.ts: the form works in raw strings, the database
 * write works in nullable columns, and neither should distort the other.
 */

import {
  AUTOMATION_STATUS_OPTIONS,
  CAUSATION_STATUS_OPTIONS,
  EVENT_TYPE_OPTIONS,
  OCCURRED_ON_PRECISION_OPTIONS,
  REVIEW_STATUS_OPTIONS,
  SYSTEM_VERSION_KNOWLEDGE_OPTIONS,
  VALENCE_OPTIONS,
} from "@/lib/events/labels";
import type {
  AutomationStatus,
  CausationStatus,
  DatePrecision,
  EventType,
  ReviewStatus,
  SystemVersionKnowledge,
  Valence,
} from "@/lib/events/types";

/** Every field name on the form. Used to key both inputs and field errors. */
export type EventFormField =
  | "slug"
  | "title"
  | "summary"
  | "occurredOn"
  | "occurredOnPrecision"
  | "locationText"
  | "locationCountryCode"
  | "developerOrOperator"
  | "systemName"
  | "automationStatus"
  | "systemVersion"
  | "systemVersionKnowledge"
  | "eventType"
  | "valence"
  | "observedFacts"
  | "unknowns"
  | "interpretation"
  | "causationStatus"
  | "causationNote"
  | "reviewStatus"
  | "recordUpdated";

export type FieldErrors = Partial<Record<EventFormField, string>>;

/** Result of a server action, consumed by useActionState in the client form. */
export interface EventFormState {
  /** null = untouched; false = rejected. Success paths redirect instead. */
  ok: boolean | null;
  message?: string;
  fieldErrors?: FieldErrors;
}

export const INITIAL_FORM_STATE: EventFormState = { ok: null };

/** Raw string shape the form renders. `""` means "not provided". */
export interface EventFormValues {
  slug: string;
  title: string;
  summary: string;
  occurredOn: string;
  occurredOnPrecision: DatePrecision;
  locationText: string;
  locationCountryCode: string;
  developerOrOperator: string;
  systemName: string;
  automationStatus: AutomationStatus;
  systemVersion: string;
  systemVersionKnowledge: SystemVersionKnowledge;
  eventType: EventType | "";
  valence: Valence | "";
  observedFacts: string;
  unknowns: string;
  interpretation: string;
  causationStatus: CausationStatus;
  causationNote: string;
  reviewStatus: ReviewStatus | "";
  recordUpdated: string;
}

/** Validated, database-shaped input. Nulls where a column is absent. */
export interface EventWriteInput {
  slug: string;
  title: string;
  summary: string;
  occurredOn: string | null;
  occurredOnPrecision: DatePrecision;
  locationText: string | null;
  locationCountryCode: string | null;
  developerOrOperator: string;
  systemName: string | null;
  automationStatus: AutomationStatus;
  systemVersion: string | null;
  systemVersionKnowledge: SystemVersionKnowledge;
  eventType: EventType;
  valence: Valence;
  observedFacts: string[];
  unknowns: string[];
  interpretation: string | null;
  causationStatus: CausationStatus;
  causationNote: string | null;
  reviewStatus: ReviewStatus;
  recordUpdated: string;
}

/** Blank form for the "new draft" page. `today` is an ISO YYYY-MM-DD string. */
export function emptyEventFormValues(today: string): EventFormValues {
  return {
    slug: "",
    title: "",
    summary: "",
    occurredOn: "",
    occurredOnPrecision: "unknown",
    locationText: "",
    locationCountryCode: "",
    developerOrOperator: "",
    systemName: "",
    automationStatus: "unknown",
    systemVersion: "",
    systemVersionKnowledge: "unknown",
    eventType: "",
    valence: "",
    observedFacts: "",
    unknowns: "",
    interpretation: "",
    causationStatus: "undetermined",
    causationNote: "",
    reviewStatus: "",
    recordUpdated: today,
  };
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

/**
 * Matches the placeholder slug `approve_submission_and_create_draft` assigns
 * a newly-converted private draft: `'draft-' || left(md5(...), 8)`
 * (supabase/migrations/20260903000000_submission_to_draft_conversion.sql) —
 * the literal "draft-" prefix plus exactly 8 lower-case hex characters.
 */
export const DRAFT_SLUG_PLACEHOLDER_RE = /^draft-[0-9a-f]{8}$/;

/**
 * Derive a slug from a title, following the same rule `SLUG_RE` (above)
 * enforces server-side: lower-case words separated by single hyphens. Any
 * run of characters outside `[a-z0-9]` — including any accented or
 * non-Latin letters, which this deliberately does not try to transliterate —
 * collapses to one hyphen, and leading or trailing hyphens are trimmed, so
 * the result either satisfies `SLUG_RE` exactly or is the empty string (a
 * title with no plain a-z0-9 content).
 *
 * The ONE place this project turns a title into a slug — used only for the
 * client-side auto-slug convenience in EventForm.tsx; the server never
 * generates a slug from a title; it only validates whatever the client sent
 * against `SLUG_RE`.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function includes<T extends string>(options: readonly T[], value: string): value is T {
  return (options as readonly string[]).includes(value);
}

/**
 * Parse + validate submitted FormData. Returns the database-shaped input on
 * success, or a map of per-field messages on failure. Mirrors every CHECK
 * constraint on `public.event` so a valid parse should never be rejected by the
 * database for a content reason.
 */
export function parseEventForm(
  formData: FormData,
):
  | { ok: true; data: EventWriteInput }
  | { ok: false; fieldErrors: FieldErrors } {
  const errors: FieldErrors = {};

  const slug = field(formData, "slug").trim();
  if (!slug) errors.slug = "Enter a slug.";
  else if (!SLUG_RE.test(slug)) {
    errors.slug =
      "Use lower-case letters, numbers and single hyphens, e.g. waymo-sf-left-turn.";
  }

  const title = field(formData, "title").trim();
  if (!title) errors.title = "Enter a title.";

  const summary = field(formData, "summary").trim();
  if (!summary) errors.summary = "Enter a summary.";

  const occurredOnPrecisionRaw = field(formData, "occurredOnPrecision").trim();
  const occurredOnPrecision: DatePrecision = includes(
    OCCURRED_ON_PRECISION_OPTIONS,
    occurredOnPrecisionRaw,
  )
    ? occurredOnPrecisionRaw
    : "unknown";
  if (!includes(OCCURRED_ON_PRECISION_OPTIONS, occurredOnPrecisionRaw)) {
    errors.occurredOnPrecision = "Choose a date precision.";
  }

  const occurredOnRaw = field(formData, "occurredOn").trim();
  let occurredOn: string | null = null;
  if (occurredOnPrecision !== "unknown") {
    if (!ISO_DATE_RE.test(occurredOnRaw)) {
      errors.occurredOn = "Enter the date the event occurred.";
    } else {
      const [year, month] = occurredOnRaw.split("-");
      occurredOn =
        occurredOnPrecision === "year"
          ? `${year}-01-01`
          : occurredOnPrecision === "month"
            ? `${year}-${month}-01`
            : occurredOnRaw;
    }
  }

  const locationText = nullIfEmpty(field(formData, "locationText"));

  const locationCountryCode = nullIfEmpty(
    field(formData, "locationCountryCode").toUpperCase(),
  );
  if (locationCountryCode && !COUNTRY_RE.test(locationCountryCode)) {
    errors.locationCountryCode = "Use a two-letter country code, e.g. US.";
  }

  const developerOrOperator = field(formData, "developerOrOperator").trim();
  if (!developerOrOperator) {
    errors.developerOrOperator = "Enter the developer or operator.";
  }

  const systemName = nullIfEmpty(field(formData, "systemName"));

  const automationStatusRaw = field(formData, "automationStatus").trim();
  if (!includes(AUTOMATION_STATUS_OPTIONS, automationStatusRaw)) {
    errors.automationStatus = "Choose an automation status.";
  }

  const systemVersion = nullIfEmpty(field(formData, "systemVersion"));
  const systemVersionKnowledgeRaw = field(
    formData,
    "systemVersionKnowledge",
  ).trim();
  if (!includes(SYSTEM_VERSION_KNOWLEDGE_OPTIONS, systemVersionKnowledgeRaw)) {
    errors.systemVersionKnowledge = "Choose how the version is known.";
  } else if (systemVersion && systemVersionKnowledgeRaw === "unknown") {
    errors.systemVersionKnowledge =
      "A system version needs its knowledge level set to stated or approximate.";
  }
  // No version string => the version's knowledge level is, by definition, unknown.
  const systemVersionKnowledge: SystemVersionKnowledge = systemVersion
    ? (systemVersionKnowledgeRaw as SystemVersionKnowledge)
    : "unknown";

  const eventTypeRaw = field(formData, "eventType").trim();
  if (!includes(EVENT_TYPE_OPTIONS, eventTypeRaw)) {
    errors.eventType = "Choose an event type.";
  }

  const valenceRaw = field(formData, "valence").trim();
  if (!includes(VALENCE_OPTIONS, valenceRaw)) {
    errors.valence = "Choose an outcome.";
  }

  const observedFacts = splitLines(field(formData, "observedFacts"));
  if (observedFacts.length === 0) {
    errors.observedFacts = "Add at least one observed fact, one per line.";
  }

  // Optional: an empty array is a legitimate value — some events genuinely
  // leave nothing unestablished. Never require inventing an unknown just to
  // satisfy this field.
  const unknowns = splitLines(field(formData, "unknowns"));

  const interpretation = nullIfEmpty(field(formData, "interpretation"));

  const causationStatusRaw = field(formData, "causationStatus").trim();
  if (!includes(CAUSATION_STATUS_OPTIONS, causationStatusRaw)) {
    errors.causationStatus = "Choose a causation status.";
  }
  const causationNote = nullIfEmpty(field(formData, "causationNote"));

  const reviewStatusRaw = field(formData, "reviewStatus").trim();
  if (!includes(REVIEW_STATUS_OPTIONS, reviewStatusRaw)) {
    errors.reviewStatus = "Choose a review status.";
  }

  const recordUpdated = field(formData, "recordUpdated").trim();
  if (!ISO_DATE_RE.test(recordUpdated)) {
    errors.recordUpdated = "Enter the record-updated date.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }

  return {
    ok: true,
    data: {
      slug,
      title,
      summary,
      occurredOn,
      occurredOnPrecision,
      locationText,
      locationCountryCode,
      developerOrOperator,
      systemName,
      automationStatus: automationStatusRaw as AutomationStatus,
      systemVersion,
      systemVersionKnowledge,
      eventType: eventTypeRaw as EventType,
      valence: valenceRaw as Valence,
      observedFacts,
      unknowns,
      interpretation,
      causationStatus: causationStatusRaw as CausationStatus,
      causationNote,
      reviewStatus: reviewStatusRaw as ReviewStatus,
      recordUpdated,
    },
  };
}

/**
 * Map validated input to the exact set of `public.event` columns the admin
 * form is allowed to write. Audit and publication-lifecycle columns
 * (`created_by`, `updated_by`, `first_published_at`, `created_at`,
 * `updated_at`) are deliberately absent — the database owns them. `is_public`
 * is also absent here; the create path adds it explicitly as `false`, and the
 * edit path never sends it.
 */
export function writeInputToColumns(input: EventWriteInput) {
  return {
    slug: input.slug,
    title: input.title,
    summary: input.summary,
    occurred_on: input.occurredOn,
    occurred_on_precision: input.occurredOnPrecision,
    location_text: input.locationText,
    location_country_code: input.locationCountryCode,
    developer_or_operator: input.developerOrOperator,
    system_name: input.systemName,
    automation_status: input.automationStatus,
    system_version: input.systemVersion,
    system_version_knowledge: input.systemVersionKnowledge,
    event_type: input.eventType,
    valence: input.valence,
    observed_facts: input.observedFacts,
    unknowns: input.unknowns,
    interpretation: input.interpretation,
    causation_status: input.causationStatus,
    causation_note: input.causationNote,
    review_status: input.reviewStatus,
    record_updated: input.recordUpdated,
  };
}

/**
 * The substantive content a public event must have, in display order. Mirrors
 * `enforce_public_event_is_complete()` and `enforce_public_event_has_source()`
 * (supabase/migrations/20260904000000_unknowns_optional_for_publication.sql /
 * 20260901000000_public_event_requires_source.sql) exactly, field for field.
 * `unknowns` is deliberately NOT in this list: an event may legitimately have
 * nothing left unestablished, and the database no longer requires it either.
 *
 * This is a USABILITY aid for the publish confirmation page only — telling a
 * curator what to add before they try — not an independent gate. The database
 * triggers above are the sole authority on whether an event may actually
 * become or remain public; this function does not, and must not, relax or
 * duplicate that enforcement.
 *
 * Reuses `splitLines` so "how many observed facts are there" agrees exactly
 * with `parseEventForm`'s own validation, rather than re-implementing a
 * slightly different notion of "blank line".
 */
export function missingPublicationRequirements(
  values: EventFormValues,
  sourceCount: number,
): string[] {
  const missing: string[] = [];
  if (!values.title.trim()) missing.push("Title");
  if (!values.summary.trim()) missing.push("Summary");
  if (!values.developerOrOperator.trim()) missing.push("Developer or operator");
  if (!values.eventType) missing.push("Event type");
  if (!values.valence) missing.push("Outcome (valence)");
  if (splitLines(values.observedFacts).length === 0) {
    missing.push("At least one observed fact");
  }
  if (!values.reviewStatus) missing.push("Review status");
  if (sourceCount === 0) missing.push("At least one source");
  return missing;
}

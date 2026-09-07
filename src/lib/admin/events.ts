import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  AutomationStatus,
  CausationStatus,
  DatePrecision,
  EventType,
  ReviewStatus,
  SourceType,
  SystemVersionKnowledge,
  Valence,
} from "@/lib/events/types";

import {
  writeInputToColumns,
  type EventFormValues,
  type EventWriteInput,
  type FieldErrors,
} from "./event-form";
import {
  sourceInputToColumns,
  type SourceFieldErrors,
  type SourceFormValues,
  type SourceWriteInput,
} from "./source-form";

/**
 * Server-side data layer for the admin event-management slice.
 *
 * Every function uses the request-scoped Supabase client (publishable key,
 * curator's cookies). All access is under Row-Level Security: the curator
 * INSERT / UPDATE policies added in migration 2 authorise the writes, and the
 * database triggers own `created_by` / `updated_by` / `first_published_at` /
 * `created_at` / `updated_at` plus the publication-lifecycle rules. There is no
 * service-role client and no RLS bypass. There is no DELETE path.
 *
 * Database errors are translated to short, non-sensitive messages here; a raw
 * Supabase/PostgREST error is never returned to the browser.
 */

// --- list -----------------------------------------------------------------

export interface AdminEventListRow {
  id: string;
  slug: string;
  /** Null for an incomplete private draft — never for a public event. */
  title: string | null;
  reviewStatus: ReviewStatus | null;
  isPublic: boolean;
  developerOrOperator: string | null;
  automationStatus: AutomationStatus;
  recordUpdated: string;
}

interface RawListRow {
  id: string;
  slug: string;
  title: string | null;
  review_status: ReviewStatus | null;
  is_public: boolean;
  developer_or_operator: string | null;
  automation_status: AutomationStatus;
  record_updated: string;
}

const LIST_COLUMNS =
  "id, slug, title, review_status, is_public, developer_or_operator, " +
  "automation_status, record_updated";

/** All events, newest editorial date first, `created_at` as the tie-break. */
export async function listAdminEvents(): Promise<AdminEventListRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event")
    .select(LIST_COLUMNS)
    .order("record_updated", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("The event list could not be loaded.");
  }

  return ((data ?? []) as unknown as RawListRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    reviewStatus: row.review_status,
    isPublic: row.is_public,
    developerOrOperator: row.developer_or_operator,
    automationStatus: row.automation_status,
    recordUpdated: row.record_updated,
  }));
}

// --- single (for the edit form) ----------------------------------------------

export interface AdminEventDetail {
  id: string;
  /** Current public visibility. */
  isPublic: boolean;
  /** True once the event has ever been public: slug + first_published_at are frozen. */
  hasBeenPublished: boolean;
  values: EventFormValues;
}

interface RawDetailRow {
  id: string;
  slug: string;
  // title / summary / developer_or_operator / event_type / valence /
  // review_status are nullable at the database level as of
  // 20260903000000_submission_to_draft_conversion.sql: a PRIVATE draft (in
  // particular, one created from a submission via
  // approve_submission_and_create_draft) may not yet have a curator's
  // classification for these. A PUBLIC event can never have any of them
  // null — enforced by enforce_public_event_is_complete — so this looseness
  // only ever reaches this admin-only shape, never the public read path.
  title: string | null;
  summary: string | null;
  occurred_on: string | null;
  occurred_on_precision: DatePrecision;
  location_text: string | null;
  location_country_code: string | null;
  developer_or_operator: string | null;
  system_name: string | null;
  automation_status: AutomationStatus;
  system_version: string | null;
  system_version_knowledge: SystemVersionKnowledge;
  event_type: EventType | null;
  valence: Valence | null;
  observed_facts: string[];
  unknowns: string[];
  interpretation: string | null;
  causation_status: CausationStatus;
  causation_note: string | null;
  review_status: ReviewStatus | null;
  record_updated: string;
  is_public: boolean;
  first_published_at: string | null;
}

const DETAIL_COLUMNS =
  "id, slug, title, summary, occurred_on, occurred_on_precision, location_text, " +
  "location_country_code, developer_or_operator, system_name, automation_status, " +
  "system_version, system_version_knowledge, event_type, valence, observed_facts, " +
  "unknowns, interpretation, causation_status, causation_note, review_status, " +
  "record_updated, is_public, first_published_at";

function rowToFormValues(row: RawDetailRow): EventFormValues {
  return {
    slug: row.slug ?? "",
    title: row.title ?? "",
    summary: row.summary ?? "",
    occurredOn: row.occurred_on ?? "",
    occurredOnPrecision: row.occurred_on_precision ?? "unknown",
    locationText: row.location_text ?? "",
    locationCountryCode: row.location_country_code ?? "",
    developerOrOperator: row.developer_or_operator ?? "",
    systemName: row.system_name ?? "",
    automationStatus: row.automation_status ?? "unknown",
    systemVersion: row.system_version ?? "",
    systemVersionKnowledge: row.system_version_knowledge ?? "unknown",
    eventType: row.event_type ?? "",
    valence: row.valence ?? "",
    observedFacts: (row.observed_facts ?? []).join("\n"),
    unknowns: (row.unknowns ?? []).join("\n"),
    interpretation: row.interpretation ?? "",
    causationStatus: row.causation_status ?? "undetermined",
    causationNote: row.causation_note ?? "",
    reviewStatus: row.review_status ?? "",
    recordUpdated: row.record_updated ?? "",
  };
}

/**
 * Number of `event_source` rows attached to an event. Read under RLS via the
 * curator SELECT policy on `event_source`.
 */
export async function countEventSources(eventId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("event_source")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);

  if (error) {
    throw new Error("The source count could not be loaded.");
  }
  return count ?? 0;
}

// --- sources: list ----------------------------------------------------------

export interface AdminEventSource {
  id: string;
  url: string;
  sourceType: SourceType;
  publisher: string | null;
  label: string | null;
  publishedOn: string | null;
  publishedOnPrecision: DatePrecision;
  retrievedOn: string | null;
  note: string | null;
}

interface RawSourceRow {
  id: string;
  url: string;
  source_type: SourceType;
  publisher: string | null;
  label: string | null;
  published_on: string | null;
  published_on_precision: DatePrecision;
  retrieved_on: string | null;
  note: string | null;
}

const SOURCE_COLUMNS =
  "id, url, source_type, publisher, label, published_on, " +
  "published_on_precision, retrieved_on, note";

/**
 * All `event_source` rows attached to one event, in insertion order. Read under
 * RLS via the curator SELECT policy on `event_source`.
 */
export async function listEventSources(
  eventId: string,
): Promise<AdminEventSource[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_source")
    .select(SOURCE_COLUMNS)
    .eq("event_id", eventId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new Error("The sources for this event could not be loaded.");
  }

  return ((data ?? []) as unknown as RawSourceRow[]).map((row) => ({
    id: row.id,
    url: row.url,
    sourceType: row.source_type,
    publisher: row.publisher,
    label: row.label,
    publishedOn: row.published_on,
    publishedOnPrecision: row.published_on_precision,
    retrievedOn: row.retrieved_on,
    note: row.note,
  }));
}

/**
 * One source attached to one event, shaped for the source edit form. Both ids
 * are matched, so a source can only be loaded through its own event's route —
 * defence in depth alongside the curator SELECT policy on `event_source`.
 * `null` if the pair does not resolve to a row the curator may read.
 */
export async function getEventSource(
  eventId: string,
  sourceId: string,
): Promise<{ id: string; values: SourceFormValues } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_source")
    .select(SOURCE_COLUMNS)
    .eq("event_id", eventId)
    .eq("id", sourceId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const row = data as unknown as RawSourceRow;
  return {
    id: row.id,
    values: {
      url: row.url ?? "",
      sourceType: row.source_type ?? "",
      publisher: row.publisher ?? "",
      label: row.label ?? "",
      publishedOn: row.published_on ?? "",
      publishedOnPrecision: row.published_on_precision ?? "unknown",
      retrievedOn: row.retrieved_on ?? "",
      note: row.note ?? "",
    },
  };
}

// --- sources: write -------------------------------------------------------------

export type SourceWriteResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: SourceFieldErrors };

/** Map a Supabase/PostgREST error to a short, non-sensitive user message. */
function describeSourceError(code: string | undefined): string {
  switch (code) {
    case "23514": // check_violation (url pattern, precision/date mismatch, empty text)
    case "23502": // not_null_violation
    case "22007": // invalid_datetime_format
    case "22P02": // invalid_text_representation
      return "Some values could not be accepted. Re-check the URL, the dates and the source type.";
    case "42501": // insufficient_privilege (RLS)
      return "Your account is not permitted to make this change.";
    case "23503": // foreign_key_violation (event_id gone)
      return "That event no longer exists.";
    default:
      return "The source could not be saved. Please try again.";
  }
}

/**
 * Attach a new source to an event. `event_id` is taken ONLY from the route
 * context passed by the server action — never from the browser — and every
 * other column comes through the `sourceInputToColumns` allow-list. No audit
 * columns are sent; the `event_source_set_audit_fields` trigger owns
 * `created_by` / `updated_by`. A single INSERT authorised by the curator RLS
 * policy (`event_source_curator_insert`); there is no service-role client and
 * no RLS bypass.
 */
export async function createEventSource(
  eventId: string,
  input: SourceWriteInput,
): Promise<SourceWriteResult> {
  const supabase = await createClient();
  const payload = { ...sourceInputToColumns(input), event_id: eventId };

  const { data, error } = await supabase
    .from("event_source")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    const code = (error as PostgrestError).code;
    if (code === "23505") {
      // unique (event_id, url)
      return {
        ok: false,
        message: "That URL is already attached to this event.",
        fieldErrors: { url: "This URL is already attached to this event." },
      };
    }
    return { ok: false, message: describeSourceError(code) };
  }
  return { ok: true, id: (data as unknown as { id: string }).id };
}

/**
 * Edit an existing source. `event_id` and `id` are both taken ONLY from the
 * validated route context — never from the browser — and scope the UPDATE so a
 * source can only be changed through its own event's route. Every writable
 * column comes through the `sourceInputToColumns` allow-list; `event_id` and
 * the audit/timestamp columns are never sent (the `event_source_set_updated_at`
 * and `event_source_set_audit_fields` triggers own `updated_at` / `updated_by`).
 * A single UPDATE authorised by the curator RLS policy
 * (`event_source_curator_update`); there is no service-role client and no RLS
 * bypass. A zero-row result (missing, or not visible to this curator) is
 * reported as "no longer exists", not as a raw error.
 */
export async function updateEventSource(
  eventId: string,
  sourceId: string,
  input: SourceWriteInput,
): Promise<SourceWriteResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_source")
    .update(sourceInputToColumns(input))
    .eq("event_id", eventId)
    .eq("id", sourceId)
    .select("id")
    .maybeSingle();

  if (error) {
    const code = (error as PostgrestError).code;
    if (code === "23505") {
      // unique (event_id, url)
      return {
        ok: false,
        message: "That URL is already attached to this event.",
        fieldErrors: { url: "This URL is already attached to this event." },
      };
    }
    return { ok: false, message: describeSourceError(code) };
  }
  if (!data) {
    return { ok: false, message: "That source no longer exists." };
  }
  return { ok: true, id: (data as unknown as { id: string }).id };
}

export type SourceDeleteResult =
  | { ok: true }
  | { ok: false; reason: "last-public-source" | "not-found" | "error" };

/**
 * Detach one source from an event. `event_id` and `id` both come ONLY from the
 * validated route context and scope the DELETE, so a source can only be removed
 * through its own event's route. A single DELETE authorised by the curator RLS
 * policy (`event_source_curator_delete`); there is no service-role client and no
 * RLS bypass.
 *
 * The database is the authority on whether the delete is allowed: the
 * `event_source_enforce_not_last` trigger (migration 20260901000000) rejects
 * removal of the last source of a public event with SQLSTATE 23514. This layer
 * only classifies the outcome — it does not re-implement the rule. A zero-row
 * result (missing, or not visible to this curator) is reported as "not-found",
 * never as a raw error.
 */
export async function deleteEventSource(
  eventId: string,
  sourceId: string,
): Promise<SourceDeleteResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_source")
    .delete()
    .eq("event_id", eventId)
    .eq("id", sourceId)
    .select("id")
    .maybeSingle();

  if (error) {
    const code = (error as PostgrestError).code;
    if (code === "23514") {
      // event_source_enforce_not_last: the last source of a public event.
      return { ok: false, reason: "last-public-source" };
    }
    return { ok: false, reason: "error" };
  }
  if (!data) {
    return { ok: false, reason: "not-found" };
  }
  return { ok: true };
}

/** One event by id, shaped for the edit form. `null` if it does not exist. */
export async function getAdminEvent(id: string): Promise<AdminEventDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const row = data as unknown as RawDetailRow;
  return {
    id: row.id,
    isPublic: row.is_public,
    hasBeenPublished: row.first_published_at !== null,
    values: rowToFormValues(row),
  };
}

// --- writes -------------------------------------------------------------------

export type WriteResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: FieldErrors };

interface PostgrestError {
  code?: string;
}

/** Map a Supabase/PostgREST error to a short, non-sensitive user message. */
function describeWriteError(error: PostgrestError): WriteResult {
  switch (error.code) {
    case "23505": // unique_violation
      return {
        ok: false,
        message: "That slug is already used by another event. Choose a different one.",
        fieldErrors: { slug: "This slug is already taken." },
      };
    case "P0001": // publication-lifecycle trigger raised
      return {
        ok: false,
        message:
          "This change is blocked by the publication rules — for example, the slug of an event that has already been published cannot be changed.",
      };
    case "23514": // check_violation
    case "23502": // not_null_violation
    case "22007": // invalid_datetime_format
    case "22P02": // invalid_text_representation
      return {
        ok: false,
        message:
          "Some values could not be accepted. Re-check the dates, the country code and the version fields.",
      };
    case "42501": // insufficient_privilege (RLS)
      return {
        ok: false,
        message: "Your account is not permitted to make this change.",
      };
    default:
      return { ok: false, message: "The event could not be saved. Please try again." };
  }
}

/**
 * Create a new DRAFT event. `is_public` is set to `false` explicitly (the
 * column default is also `false`, and the lifecycle trigger rejects an
 * authenticated insert with `is_public = true`). No audit or lifecycle columns
 * are sent. A single INSERT — a failure leaves nothing behind.
 */
export async function createDraftEvent(
  input: EventWriteInput,
): Promise<WriteResult> {
  const supabase = await createClient();
  const payload = { ...writeInputToColumns(input), is_public: false };

  const { data, error } = await supabase
    .from("event")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    return describeWriteError(error);
  }
  return { ok: true, id: (data as unknown as { id: string }).id };
}

/**
 * Update an existing event's content. Never sends `is_public` or
 * `first_published_at` (no publication controls in this slice) and never sends
 * audit columns. A single UPDATE — a failure leaves the row unchanged.
 */
export async function updateEvent(
  id: string,
  input: EventWriteInput,
): Promise<WriteResult> {
  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("event")
    .select("slug, first_published_at")
    .eq("id", id)
    .maybeSingle();

  if (readError || !current) {
    return { ok: false, message: "That event no longer exists." };
  }

  const currentRow = current as unknown as {
    slug: string;
    first_published_at: string | null;
  };

  if (currentRow.first_published_at !== null && input.slug !== currentRow.slug) {
    return {
      ok: false,
      message: "The slug of an event that has already been published cannot be changed.",
      fieldErrors: { slug: "Locked — this event has already been published." },
    };
  }

  const { error } = await supabase
    .from("event")
    .update(writeInputToColumns(input))
    .eq("id", id);

  if (error) {
    return describeWriteError(error);
  }
  return { ok: true, id };
}

/**
 * Publish a draft event: the first false -> true transition of `is_public`.
 *
 * The write updates exactly ONE column — `is_public: true`. It sends no content
 * fields, no `first_published_at`, and no audit columns. Because `slug` is not
 * in the payload it is unchanged, so the database's "first publication may not
 * also rename" rule is satisfied by construction, and `first_published_at` is
 * stamped by the `enforce_event_publication_lifecycle` trigger — never by the
 * application. `updated_by` / `updated_at` are set by their existing triggers.
 *
 * A single UPDATE, guarded by fresh reads: refuses if the event is missing,
 * already public, or has zero sources. RLS (the curator UPDATE policy)
 * authorises the write; there is no service-role client and no RLS bypass.
 */
export async function publishEvent(id: string): Promise<WriteResult> {
  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("event")
    .select("is_public")
    .eq("id", id)
    .maybeSingle();

  if (readError || !current) {
    return { ok: false, message: "That event no longer exists." };
  }

  if ((current as unknown as { is_public: boolean }).is_public) {
    return { ok: false, message: "This event is already public." };
  }

  // A public event record must always have at least one source: the public read
  // path (src/lib/events/supabase-source.ts) rejects zero-source events by
  // design. A source-less draft must not become public.
  const sourceCount = await countEventSources(id);
  if (sourceCount === 0) {
    return {
      ok: false,
      message: "Add at least one source before publishing this event.",
    };
  }

  const { error } = await supabase
    .from("event")
    .update({ is_public: true })
    .eq("id", id);

  if (error) {
    return describeWriteError(error);
  }
  return { ok: true, id };
}

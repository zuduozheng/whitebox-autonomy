import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  parseAdditionalUrls,
  submissionReviewToColumns,
  type AdditionalUrlLine,
  type SubmissionListFilter,
  type SubmissionReviewFieldErrors,
  type SubmissionReviewInput,
  type SubmissionStatus,
} from "@/lib/submissions/submission-review";

/**
 * Server-side data layer for the curator submission inbox (Beta Slice 3).
 *
 * Every function uses the request-scoped Supabase client (publishable key, the
 * curator's cookies). All access is under Row-Level Security:
 *   - reads are authorised by `event_submission_curator_select`
 *     (USING public.is_curator());
 *   - the single update is authorised by `event_submission_curator_update`
 *     (USING + WITH CHECK public.is_curator()).
 * There is no service-role client and no RLS bypass. There is no INSERT path and
 * no DELETE path — the public /submit form owns the only INSERT, and no role may
 * DELETE. This module NEVER references `event` or `event_source`.
 *
 * Database errors are translated to short, non-sensitive messages here; a raw
 * Supabase/PostgREST error is never returned to the browser, and submission
 * content / submitter email are never logged.
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

/** Deterministic UTC timestamp rendering — no locale dependency. */
export function formatTimestampUtc(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const day = dt.getUTCDate();
  const month = MONTHS[dt.getUTCMonth()] ?? "";
  const year = dt.getUTCFullYear();
  const hh = String(dt.getUTCHours()).padStart(2, "0");
  const mm = String(dt.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hh}:${mm} UTC`;
}

// --- list -------------------------------------------------------------------

export interface SubmissionListRow {
  id: string;
  evidenceUrl: string;
  developerOrOperator: string | null;
  locationText: string | null;
  eventDate: string | null;
  status: SubmissionStatus;
  hasCuratorNote: boolean;
  hasSubmitterEmail: boolean;
  additionalUrlCount: number;
  createdAt: string;
  reviewedAt: string | null;
}

interface RawListRow {
  id: string;
  evidence_url: string;
  developer_or_operator: string | null;
  location_text: string | null;
  event_date: string | null;
  additional_urls: string | null;
  curator_note: string | null;
  submitter_email: string | null;
  status: SubmissionStatus;
  created_at: string;
  reviewed_at: string | null;
}

const LIST_COLUMNS =
  "id, evidence_url, developer_or_operator, location_text, event_date, " +
  "additional_urls, curator_note, submitter_email, status, created_at, reviewed_at";

/**
 * Submissions for the inbox list, newest first. A `filter` other than "all"
 * narrows by status and is served by the (status, created_at desc) index.
 * `curator_note` and `submitter_email` are read only to derive boolean presence
 * flags — the note text and the address itself never leave this function.
 */
export async function listSubmissions(
  filter: SubmissionListFilter,
): Promise<SubmissionListRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("event_submission")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false });

  if (filter !== "all") {
    query = query.eq("status", filter);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error("The submissions list could not be loaded.");
  }

  return ((data ?? []) as unknown as RawListRow[]).map((row) => ({
    id: row.id,
    evidenceUrl: row.evidence_url,
    developerOrOperator: row.developer_or_operator,
    locationText: row.location_text,
    eventDate: row.event_date,
    status: row.status,
    hasCuratorNote: row.curator_note != null,
    hasSubmitterEmail: row.submitter_email != null,
    additionalUrlCount: parseAdditionalUrls(row.additional_urls).length,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  }));
}

// --- detail ---------------------------------------------------------------

export interface SubmissionDetail {
  id: string;
  evidenceUrl: string;
  whatHappened: string | null;
  developerOrOperator: string | null;
  locationText: string | null;
  eventDate: string | null;
  additionalUrls: AdditionalUrlLine[];
  submitterEmail: string | null;
  status: SubmissionStatus;
  curatorNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** The private draft event created from this submission, if any. */
  linkedEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawDetailRow {
  id: string;
  evidence_url: string;
  what_happened: string | null;
  developer_or_operator: string | null;
  location_text: string | null;
  event_date: string | null;
  additional_urls: string | null;
  submitter_email: string | null;
  status: SubmissionStatus;
  curator_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  linked_event_id: string | null;
  created_at: string;
  updated_at: string;
}

const DETAIL_COLUMNS =
  "id, evidence_url, what_happened, developer_or_operator, location_text, " +
  "event_date, additional_urls, submitter_email, status, curator_note, " +
  "reviewed_by, reviewed_at, linked_event_id, created_at, updated_at";

/** One submission by id, or `null` if it does not resolve to a readable row. */
export async function getSubmission(
  id: string,
): Promise<SubmissionDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_submission")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const row = data as unknown as RawDetailRow;
  return {
    id: row.id,
    evidenceUrl: row.evidence_url,
    whatHappened: row.what_happened,
    developerOrOperator: row.developer_or_operator,
    locationText: row.location_text,
    eventDate: row.event_date,
    additionalUrls: parseAdditionalUrls(row.additional_urls),
    submitterEmail: row.submitter_email,
    status: row.status,
    curatorNote: row.curator_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    linkedEventId: row.linked_event_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- update -------------------------------------------------------------

export type SubmissionReviewResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: SubmissionReviewFieldErrors };

/** Map a Supabase/PostgREST error code to a short, non-sensitive message. */
function describeReviewError(code: string | undefined): string {
  switch (code) {
    case "23514": // check_violation (status value, note length/blank, review stamp)
    case "23502": // not_null_violation
    case "22P02": // invalid_text_representation
      return "Some values could not be accepted. Re-check the note and the status.";
    case "42501": // insufficient_privilege (RLS)
      return "Your account is not permitted to make this change.";
    default:
      return "The review could not be saved. Please try again.";
  }
}

/**
 * Apply a curator decision. The payload is the fixed allow-list
 * { status, curator_note } and nothing else: `reviewed_by` / `reviewed_at` are
 * owned by the `event_submission_manage_review_fields` BEFORE UPDATE trigger
 * (stamped from auth.uid() / now(), or cleared when the status returns to
 * 'pending'), and `updated_at` by `event_submission_set_updated_at`. A single
 * UPDATE authorised by `event_submission_curator_update`; no service-role
 * client, no RLS bypass, and no `event` / `event_source` write. A zero-row
 * result (missing, or not visible to this curator) is reported as "no longer
 * exists", never as a raw error.
 */
export async function updateSubmissionReview(
  id: string,
  input: SubmissionReviewInput,
): Promise<SubmissionReviewResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_submission")
    .update(submissionReviewToColumns(input))
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      message: describeReviewError((error as { code?: string }).code),
    };
  }
  if (!data) {
    return { ok: false, message: "That submission no longer exists." };
  }
  return { ok: true };
}

// --- approve & create draft -------------------------------------------------

export type ApproveSubmissionResult =
  | { ok: true; eventId: string }
  | { ok: false; message: string };

/** Map a Supabase/PostgREST error from the RPC call to a short, non-sensitive message. */
function describeApproveError(code: string | undefined): string {
  switch (code) {
    case "42501": // insufficient_privilege (RLS, or the function's own is_curator() check)
      return "Your account is not permitted to make this change.";
    case "P0002": // no_data_found — raised by the function when the id doesn't resolve
      return "That submission no longer exists.";
    case "23505": // unique_violation — an extremely unlikely generated-slug collision
      return "The draft could not be created. Please try again.";
    default:
      return "The draft event could not be created. Please try again.";
  }
}

/**
 * Approve a submission and create its private draft event, via the single
 * transactional `public.approve_submission_and_create_draft` database
 * function (supabase/migrations/20260903000000_submission_to_draft_conversion.sql).
 *
 * This is the ONLY place that function is called from. It uses the same
 * request-scoped Supabase client (publishable key, the curator's cookies) as
 * every other write in this module — the function is SECURITY INVOKER, so it
 * runs under RLS as the calling curator; there is no service-role client and
 * no RLS bypass here or inside the function. The function itself is
 * idempotent: calling it again for an already-converted submission returns
 * the same event id instead of creating a second draft, so this wrapper needs
 * no separate "already linked" guard of its own.
 */
export async function approveSubmissionAndCreateDraft(
  id: string,
): Promise<ApproveSubmissionResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "approve_submission_and_create_draft",
    { p_submission_id: id },
  );

  if (error) {
    return {
      ok: false,
      message: describeApproveError((error as { code?: string }).code),
    };
  }
  return { ok: true, eventId: data as string };
}

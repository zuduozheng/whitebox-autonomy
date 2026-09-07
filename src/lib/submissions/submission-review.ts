/**
 * Curator submission-review form — shared, side-effect-free logic used by both
 * the client form component and the Server Action, plus small display helpers
 * for the inbox pages.
 *
 * Contains NO database access, NO secrets and NO server-only imports, so it is
 * safe to import from a Client Component. Parsing / validation of the submitted
 * FormData happens here and is re-run authoritatively inside the Server Action;
 * the browser is never trusted.
 *
 * The two writable fields below mirror the CHECK constraints on
 * `public.event_submission` that a curator UPDATE can touch
 * (supabase/migrations/20260902000000_public_event_submission.sql):
 *   - status       IN ('pending','accepted','rejected','spam')
 *   - curator_note NULL or (length(trim(...)) > 0 AND length(...) <= 4000)
 * `reviewed_by`, `reviewed_at` and `updated_at` are database-owned and are
 * never part of any payload built here.
 */

export const SUBMISSION_STATUS_OPTIONS = [
  "pending",
  "accepted",
  "rejected",
  "spam",
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUS_OPTIONS)[number];

const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  spam: "Spam",
};

export function submissionStatusLabel(value: SubmissionStatus): string {
  return SUBMISSION_STATUS_LABELS[value];
}

export function isSubmissionStatus(value: string): value is SubmissionStatus {
  return (SUBMISSION_STATUS_OPTIONS as readonly string[]).includes(value);
}

/** Inbox list filters: the four statuses plus an unfiltered "all" view. */
export const SUBMISSION_LIST_FILTERS = [
  "pending",
  "accepted",
  "rejected",
  "spam",
  "all",
] as const;

export type SubmissionListFilter = (typeof SUBMISSION_LIST_FILTERS)[number];

export function isSubmissionListFilter(
  value: string,
): value is SubmissionListFilter {
  return (SUBMISSION_LIST_FILTERS as readonly string[]).includes(value);
}

// --- review form ----------------------------------------------------------

export type SubmissionReviewFormField = "status" | "curatorNote";

export type SubmissionReviewFieldErrors = Partial<
  Record<SubmissionReviewFormField, string>
>;

/** Result of the review Server Action, consumed by useActionState. */
export interface SubmissionReviewFormState {
  /** null = untouched; false = rejected. Success redirects instead. */
  ok: boolean | null;
  message?: string;
  fieldErrors?: SubmissionReviewFieldErrors;
}

export const INITIAL_SUBMISSION_REVIEW_STATE: SubmissionReviewFormState = {
  ok: null,
};

/** Validated, database-shaped review input. */
export interface SubmissionReviewInput {
  status: SubmissionStatus;
  curatorNote: string | null;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Parse + validate submitted review FormData. Returns the database-shaped input
 * on success, or a map of per-field messages on failure.
 */
export function parseSubmissionReview(
  formData: FormData,
):
  | { ok: true; data: SubmissionReviewInput }
  | { ok: false; fieldErrors: SubmissionReviewFieldErrors } {
  const errors: SubmissionReviewFieldErrors = {};

  const statusRaw = field(formData, "status").trim();
  const status = isSubmissionStatus(statusRaw) ? statusRaw : null;
  if (!status) {
    errors.status = "Choose a status.";
  }

  const curatorNoteTrimmed = field(formData, "curatorNote").trim();
  let curatorNote: string | null = null;
  if (curatorNoteTrimmed.length > 0) {
    if (curatorNoteTrimmed.length > 4000) {
      errors.curatorNote = "This note is too long (4000 characters maximum).";
    } else {
      curatorNote = curatorNoteTrimmed;
    }
  }

  if (!status || Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }

  return { ok: true, data: { status, curatorNote } };
}

/**
 * Map validated input to the EXACT set of `public.event_submission` columns a
 * curator review is allowed to write: `status` and `curator_note` only.
 * Everything else on the row is owned by the database (triggers / defaults) or
 * by the public submitter and is deliberately absent here.
 */
export function submissionReviewToColumns(input: SubmissionReviewInput) {
  return {
    status: input.status,
    curator_note: input.curatorNote,
  };
}

// --- additional_urls display ---------------------------------------------------

export interface AdditionalUrlLine {
  /** The line exactly as stored (trimmed). Always rendered as text. */
  text: string;
  /** Non-null only when the whole line is a valid http(s) URL: the safe href. */
  href: string | null;
}

/**
 * Split the stored `additional_urls` free text into display lines. Each line is
 * trimmed; blank lines are dropped. A line is offered as a link ONLY when the
 * entire line is a syntactically valid absolute http:// or https:// URL —
 * otherwise it is shown as plain text. No "find URLs inside arbitrary text"
 * parsing is performed, and callers never pass any of this to
 * dangerouslySetInnerHTML.
 */
export function parseAdditionalUrls(raw: string | null): AdditionalUrlLine[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ text: line, href: safeHttpUrl(line) }));
}

function safeHttpUrl(line: string): string | null {
  if (/\s/.test(line)) return null;
  if (!/^https?:\/\//i.test(line)) return null;
  try {
    const parsed = new URL(line);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? line
      : null;
  } catch {
    return null;
  }
}

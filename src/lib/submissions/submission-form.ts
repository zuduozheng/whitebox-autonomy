/**
 * Public event-submission form — shared, side-effect-free logic used by both the
 * client form component and the Server Action.
 *
 * Contains NO database access, NO secrets and NO server-only imports, so it is
 * safe to import from a Client Component. Parsing / validation of the submitted
 * FormData happens here and is re-run authoritatively inside the Server Action;
 * the browser is never trusted.
 *
 * Every rule below mirrors a CHECK constraint on `public.event_submission`
 * (supabase/migrations/20260902000000_public_event_submission.sql) so a valid
 * parse should never be rejected by the database for a content reason, and an
 * invalid one is caught here with a friendly message instead of a raw 400.
 */

/**
 * Name of the anti-spam honeypot input. It is rendered hidden from people and
 * assistive technology; a real submission always leaves it empty. It is read in
 * the Server Action and NEVER placed in the database payload — the table has no
 * such column.
 */
export const HONEYPOT_FIELD = "company";

/** Every real field on the form. Keys both inputs and field errors. */
export type SubmissionFormField =
  | "evidenceUrl"
  | "whatHappened"
  | "developerOrOperator"
  | "locationText"
  | "eventDate"
  | "additionalUrls"
  | "submitterEmail";

export type SubmissionFieldErrors = Partial<Record<SubmissionFormField, string>>;

/** Result of the Server Action, consumed by useActionState in the client form. */
export interface SubmissionFormState {
  /** null = untouched; true = received; false = rejected. */
  ok: boolean | null;
  message?: string;
  fieldErrors?: SubmissionFieldErrors;
}

export const INITIAL_SUBMISSION_FORM_STATE: SubmissionFormState = { ok: null };

/** Validated, database-shaped input. Nulls where an optional value is absent. */
export interface SubmissionWriteInput {
  evidenceUrl: string;
  whatHappened: string | null;
  developerOrOperator: string | null;
  locationText: string | null;
  eventDate: string | null;
  additionalUrls: string | null;
  submitterEmail: string | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Mirrors the CHECK on `submitter_email`:
 *   submitter_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 * (a single "@", at least one "." in the domain, no whitespace).
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** True only for a real calendar date in strict YYYY-MM-DD form. */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return false;
  // Reject values JS would silently roll over (e.g. 2026-02-30).
  return new Date(timestamp).toISOString().slice(0, 10) === value;
}

/**
 * Trim an optional text field. Empty -> null (the column stays unknown). A
 * present value must be <= `max` characters; the database also requires
 * `length(trim(x)) > 0`, which a trimmed non-empty string satisfies by
 * construction.
 */
function optionalText(
  formData: FormData,
  name: SubmissionFormField,
  max: number,
  errors: SubmissionFieldErrors,
  tooLongMessage: string,
): string | null {
  const trimmed = field(formData, name).trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    errors[name] = tooLongMessage;
    return null;
  }
  return trimmed;
}

/**
 * Parse + validate submitted FormData. Returns the database-shaped input on
 * success, or a map of per-field messages on failure. The honeypot is NOT read
 * here — the Server Action handles it before calling this.
 */
export function parseSubmissionForm(
  formData: FormData,
):
  | { ok: true; data: SubmissionWriteInput }
  | { ok: false; fieldErrors: SubmissionFieldErrors } {
  const errors: SubmissionFieldErrors = {};

  // evidence_url — required. Mirrors:
  //   evidence_url ~ '^https?://'  AND  length(evidence_url) <= 2048
  // The scheme is lower-cased so a value like "HTTPS://..." still satisfies the
  // case-sensitive database regex; structural validity is checked with URL().
  let evidenceUrl = field(formData, "evidenceUrl").trim();
  if (!evidenceUrl) {
    errors.evidenceUrl =
      "Enter a public link to the video or report showing this event.";
  } else {
    evidenceUrl = evidenceUrl.replace(
      /^(https?):\/\//i,
      (_match, scheme: string) => `${scheme.toLowerCase()}://`,
    );
    if (!/^https?:\/\//.test(evidenceUrl)) {
      errors.evidenceUrl = "The link must start with http:// or https://.";
    } else if (evidenceUrl.length > 2048) {
      errors.evidenceUrl = "This link is too long (2048 characters maximum).";
    } else {
      try {
        new URL(evidenceUrl);
      } catch {
        errors.evidenceUrl = "Enter a valid link, including the https:// prefix.";
      }
    }
  }

  const whatHappened = optionalText(
    formData,
    "whatHappened",
    4000,
    errors,
    "This description is too long (4000 characters maximum).",
  );
  const developerOrOperator = optionalText(
    formData,
    "developerOrOperator",
    200,
    errors,
    "This is too long (200 characters maximum).",
  );
  const locationText = optionalText(
    formData,
    "locationText",
    500,
    errors,
    "This is too long (500 characters maximum).",
  );
  const additionalUrls = optionalText(
    formData,
    "additionalUrls",
    4000,
    errors,
    "This is too long (4000 characters maximum).",
  );

  // event_date — optional, exact calendar date only. An unknown date stays null;
  // nothing is inferred.
  const eventDateRaw = field(formData, "eventDate").trim();
  let eventDate: string | null = null;
  if (eventDateRaw) {
    if (!isValidIsoDate(eventDateRaw)) {
      errors.eventDate = "Enter a real date, or leave this blank.";
    } else {
      eventDate = eventDateRaw;
    }
  }

  // submitter_email — optional; mirrors the database regex and length cap.
  const submitterEmailRaw = field(formData, "submitterEmail").trim();
  let submitterEmail: string | null = null;
  if (submitterEmailRaw) {
    if (submitterEmailRaw.length > 320 || !EMAIL_RE.test(submitterEmailRaw)) {
      errors.submitterEmail = "Enter a valid email address, or leave this blank.";
    } else {
      submitterEmail = submitterEmailRaw;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }

  return {
    ok: true,
    data: {
      evidenceUrl,
      whatHappened,
      developerOrOperator,
      locationText,
      eventDate,
      additionalUrls,
      submitterEmail,
    },
  };
}

/**
 * Map validated input to the exact set of `public.event_submission` columns a
 * public submitter is allowed to write. `status`, `curator_note`,
 * `reviewed_by`, `reviewed_at`, `id`, `created_at` and `updated_at` are
 * deliberately absent — the anon INSERT policy and the intake trigger own them.
 * The honeypot is never represented here.
 */
export function submissionInputToColumns(input: SubmissionWriteInput) {
  return {
    evidence_url: input.evidenceUrl,
    what_happened: input.whatHappened,
    developer_or_operator: input.developerOrOperator,
    location_text: input.locationText,
    event_date: input.eventDate,
    additional_urls: input.additionalUrls,
    submitter_email: input.submitterEmail,
  };
}

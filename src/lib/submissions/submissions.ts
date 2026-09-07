import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  submissionInputToColumns,
  type SubmissionWriteInput,
} from "./submission-form";

/**
 * Public event-submission intake — write path.
 *
 * Access model mirrors src/lib/events/supabase-source.ts: a dedicated,
 * cookie-less client built on the project's publishable ("anon") key. It carries
 * no auth session, so every call runs as the PostgreSQL `anon` role and is
 * authorised solely by the `event_submission_anon_insert` Row-Level Security
 * policy — a signed-in curator in the same browser is irrelevant here. There is
 * no service-role key.
 *
 * The only statement this module ever issues is ONE INSERT with
 * `Prefer: return=minimal` (no `.select()` / no RETURNING). `anon` has no SELECT
 * policy on the table, so there is nothing to read back and no read-after-write.
 */

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
    `Public submission intake is not configured: missing ${missing}. Copy ` +
      ".env.example to .env.local and set the project URL and publishable key " +
      "(Supabase dashboard -> Project Settings -> API).",
  );
}

// supabase-js wants the bare project origin and appends "/rest/v1" itself.
// Tolerate a value that already carries the REST path (a common copy/paste).
const SUPABASE_URL = RAW_SUPABASE_URL.replace(/\/+$/, "").replace(
  /\/rest\/v1$/,
  "",
);

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type SubmissionResult = { ok: true } | { ok: false; message: string };

/** Map a PostgREST error code to a short, non-sensitive message. */
function describeSubmissionError(code: string | undefined): string {
  switch (code) {
    case "23514": // check_violation (url shape, length, non-blank text)
    case "23502": // not_null_violation (evidence_url missing)
    case "22007": // invalid_datetime_format
    case "22008": // datetime_field_overflow
    case "22P02": // invalid_text_representation
      return (
        "Some of the details could not be accepted. Re-check the link, the " +
        "date and the email address."
      );
    case "42501": // insufficient_privilege (RLS)
      return "This submission could not be accepted.";
    default:
      return "The submission could not be sent right now. Please try again.";
  }
}

/**
 * Insert one pending submission. Exactly one statement is issued; a failure
 * leaves nothing behind. The row is normalised to a clean `pending` state with
 * no review metadata by the table's BEFORE INSERT trigger, whatever is sent
 * here. The raw Supabase/PostgREST error is never returned to the browser.
 */
export async function createSubmission(
  input: SubmissionWriteInput,
): Promise<SubmissionResult> {
  const { error } = await supabase
    .from("event_submission")
    .insert(submissionInputToColumns(input));

  if (error) {
    return {
      ok: false,
      message: describeSubmissionError((error as { code?: string }).code),
    };
  }
  return { ok: true };
}

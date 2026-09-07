"use server";

import {
  HONEYPOT_FIELD,
  parseSubmissionForm,
  type SubmissionFormState,
} from "@/lib/submissions/submission-form";
import { createSubmission } from "@/lib/submissions/submissions";

/**
 * Server Action for the public /submit form. It:
 *   1. checks the anti-spam honeypot: if it was filled, return the SAME generic
 *      success state and write nothing (the trap is never revealed);
 *   2. re-parses + re-validates the submitted FormData authoritatively, mirroring
 *      every CHECK on `public.event_submission`;
 *   3. delegates a single anonymous INSERT to the intake data layer;
 *   4. returns a state the client form renders as inline errors or a restrained
 *      thank-you — no raw database error ever reaches the browser.
 *
 * No authentication: submitting is a public action. No redirect: there is
 * nothing to read back (anon has no SELECT on the table) and no reference to
 * show, so success is rendered in place.
 */
export async function submitEventAction(
  _prevState: SubmissionFormState,
  formData: FormData,
): Promise<SubmissionFormState> {
  const honeypot = formData.get(HONEYPOT_FIELD);
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    return { ok: true };
  }

  const parsed = parseSubmissionForm(formData);
  if (!parsed.ok) {
    return {
      ok: false,
      message: "Some details need attention before this can be sent.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  const result = await createSubmission(parsed.data);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  return { ok: true };
}

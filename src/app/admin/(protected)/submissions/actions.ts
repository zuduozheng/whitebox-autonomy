"use server";

import { redirect } from "next/navigation";

import {
  approveSubmissionAndCreateDraft,
  updateSubmissionReview,
} from "@/lib/admin/submissions";
import { requireCurator } from "@/lib/auth/require-curator";
import {
  parseSubmissionReview,
  type SubmissionReviewFormState,
} from "@/lib/submissions/submission-review";

/**
 * Server action for the curator submission-review form. It:
 *   1. re-checks the curator boundary on the server (never trusts the page gate
 *      alone; redirects to /admin/login if the session has ended);
 *   2. validates that the route id is a well-formed UUID coming from the route
 *      context — never from an editable input;
 *   3. re-parses + re-validates the submitted FormData authoritatively;
 *   4. delegates a single UPDATE — of `status` and `curator_note` only — to the
 *      server-only data layer;
 *   5. on success, redirects back to the review page; on failure, returns a
 *      state the client form renders as inline errors — no raw database error
 *      reaches the browser.
 *
 * This form never writes `event` / `event_source`: accepting a submission
 * here alone still does not create an Observatory event. The separate
 * `approveSubmissionAndCreateDraftAction` below is the only path that does.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function updateSubmissionReviewAction(
  id: string,
  _prevState: SubmissionReviewFormState,
  formData: FormData,
): Promise<SubmissionReviewFormState> {
  await requireCurator();

  if (!UUID_RE.test(id)) {
    return { ok: false, message: "That submission could not be found." };
  }

  const parsed = parseSubmissionReview(formData);
  if (!parsed.ok) {
    return {
      ok: false,
      message: "Some fields need attention.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  const result = await updateSubmissionReview(id, parsed.data);
  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }

  redirect(`/admin/submissions/${id}?saved=1`);
}

/**
 * Approve a submission and create its private draft event. Re-checks the
 * curator boundary on the server, then delegates the single atomic RPC call
 * to the data layer. The created event is always private — publication is
 * unchanged and still goes through the existing "Publish event" confirmation
 * page. On success, redirects straight to the existing event editor (the same
 * page a manually-created draft lands on) so this reuses the existing
 * edit/publish workflow rather than introducing a parallel one. On failure,
 * redirects back to the review page with a generic error marker; no raw
 * database error reaches the browser.
 */
export async function approveSubmissionAndCreateDraftAction(
  id: string,
): Promise<void> {
  await requireCurator();

  if (!UUID_RE.test(id)) {
    redirect("/admin/submissions");
  }

  const result = await approveSubmissionAndCreateDraft(id);
  if (!result.ok) {
    redirect(`/admin/submissions/${id}?approveError=1`);
  }

  redirect(`/admin/events/${result.eventId}/edit?fromSubmission=1`);
}

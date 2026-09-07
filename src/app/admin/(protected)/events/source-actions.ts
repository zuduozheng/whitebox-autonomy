"use server";

import { redirect } from "next/navigation";

import {
  createEventSource,
  deleteEventSource,
  updateEventSource,
} from "@/lib/admin/events";
import { parseSourceForm, type SourceFormState } from "@/lib/admin/source-form";
import { requireCurator } from "@/lib/auth/require-curator";

/**
 * Server actions for the admin source form. Each one:
 *   1. re-checks the curator boundary on the server (never trusts the page gate
 *      alone; redirects to /admin/login if the session has ended);
 *   2. validates that the route ids (event id, and source id when editing) are
 *      well-formed UUIDs coming from the route — never from editable inputs;
 *   3. re-parses + re-validates the submitted FormData authoritatively;
 *   4. delegates the single write to the server-only data layer, which derives
 *      `event_id` / the target row from those route ids — never from the
 *      FormData;
 *   5. on success, redirects to the event edit page; on failure, returns a
 *      state the client form renders as inline errors — no raw database error
 *      reaches the browser.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createSourceAction(
  eventId: string,
  _prevState: SourceFormState,
  formData: FormData,
): Promise<SourceFormState> {
  await requireCurator();

  if (!UUID_RE.test(eventId)) {
    return { ok: false, message: "That event could not be found." };
  }

  const parsed = parseSourceForm(formData);
  if (!parsed.ok) {
    return {
      ok: false,
      message: "Some fields need attention.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  const result = await createEventSource(eventId, parsed.data);
  if (!result.ok) {
    return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
  }

  redirect(`/admin/events/${eventId}/edit?sourceAdded=1`);
}

export async function updateSourceAction(
  eventId: string,
  sourceId: string,
  _prevState: SourceFormState,
  formData: FormData,
): Promise<SourceFormState> {
  await requireCurator();

  if (!UUID_RE.test(eventId) || !UUID_RE.test(sourceId)) {
    return { ok: false, message: "That source could not be found." };
  }

  const parsed = parseSourceForm(formData);
  if (!parsed.ok) {
    return {
      ok: false,
      message: "Some fields need attention.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  const result = await updateEventSource(eventId, sourceId, parsed.data);
  if (!result.ok) {
    return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
  }

  redirect(`/admin/events/${eventId}/edit?sourceUpdated=1`);
}

/**
 * Delete one source. Redirect-based, not useActionState: the confirmation page
 * is a plain Server Component with a <form action>. Both ids come from the
 * action binding (route context) — never from FormData — and are re-validated
 * as UUIDs here; the data layer scopes the DELETE by both. RLS
 * (`event_source_curator_delete`) authorises it; there is no service-role
 * client and no RLS bypass. On rejection it returns to the confirmation page
 * with a short reason code; the database is the authority on the last-source
 * rule and no raw database error is ever surfaced.
 */
export async function deleteSourceAction(
  eventId: string,
  sourceId: string,
): Promise<void> {
  await requireCurator();

  if (!UUID_RE.test(eventId) || !UUID_RE.test(sourceId)) {
    redirect("/admin/events");
  }

  const result = await deleteEventSource(eventId, sourceId);
  if (!result.ok) {
    redirect(
      `/admin/events/${eventId}/sources/${sourceId}/delete?error=${result.reason}`,
    );
  }

  redirect(`/admin/events/${eventId}/edit?sourceDeleted=1`);
}

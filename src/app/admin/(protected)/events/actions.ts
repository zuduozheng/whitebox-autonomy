"use server";

import { redirect } from "next/navigation";

import { createDraftEvent, publishEvent, updateEvent } from "@/lib/admin/events";
import { parseEventForm, type EventFormState } from "@/lib/admin/event-form";
import { requireCurator } from "@/lib/auth/require-curator";

/**
 * Server actions for the admin event form. Each one:
 *   1. re-checks the curator boundary on the server (never trusts the page gate
 *      alone; redirects to /admin/login if the session has ended);
 *   2. re-parses + re-validates the submitted FormData authoritatively;
 *   3. delegates the single write to the server-only data layer;
 *   4. on success, redirects; on failure, returns a state the client form
 *      renders as inline errors — no raw database error reaches the browser.
 */

export async function createEventAction(
  _prevState: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  await requireCurator();

  const parsed = parseEventForm(formData);
  if (!parsed.ok) {
    return {
      ok: false,
      message: "Some fields need attention.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  const result = await createDraftEvent(parsed.data);
  if (!result.ok) {
    return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
  }

  redirect(`/admin/events/${result.id}/edit?created=1`);
}

export async function updateEventAction(
  id: string,
  _prevState: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  await requireCurator();

  const parsed = parseEventForm(formData);
  if (!parsed.ok) {
    return {
      ok: false,
      message: "Some fields need attention.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  const result = await updateEvent(id, parsed.data);
  if (!result.ok) {
    return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
  }

  redirect(`/admin/events/${id}/edit?saved=1`);
}

/**
 * Publish a draft (first is_public false -> true). Deliberately not wired to the
 * edit form: it is confirmed on its own page and performs the narrow
 * publishEvent(id) write. On failure it returns to the confirmation page with a
 * generic marker; no raw database error reaches the browser.
 */
export async function publishEventAction(id: string): Promise<void> {
  await requireCurator();

  const result = await publishEvent(id);
  if (!result.ok) {
    redirect(`/admin/events/${id}/publish?error=1`);
  }

  redirect(`/admin/events/${id}/edit?published=1`);
}

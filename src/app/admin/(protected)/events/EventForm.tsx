"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";

import {
  AUTOMATION_STATUS_OPTIONS,
  CAUSATION_STATUS_OPTIONS,
  EVENT_TYPE_OPTIONS,
  OCCURRED_ON_PRECISION_OPTIONS,
  REVIEW_STATUS_OPTIONS,
  SYSTEM_VERSION_KNOWLEDGE_OPTIONS,
  VALENCE_OPTIONS,
  automationStatusLabel,
  causationStatusLabel,
  eventTypeLabel,
  occurredOnPrecisionLabel,
  reviewStatusLabel,
  systemVersionKnowledgeLabel,
  valenceLabel,
} from "@/lib/events/labels";
import {
  DRAFT_SLUG_PLACEHOLDER_RE,
  INITIAL_FORM_STATE,
  slugify,
  type EventFormField,
  type EventFormState,
  type EventFormValues,
} from "@/lib/admin/event-form";

import styles from "./EventForm.module.css";

type FormAction = (
  prevState: EventFormState,
  formData: FormData,
) => Promise<EventFormState>;

interface EventFormProps {
  mode: "create" | "edit";
  action: FormAction;
  initialValues: EventFormValues;
  /** Edit mode: true once the event has been published (slug is frozen). */
  slugLocked?: boolean;
  cancelHref: string;
}

function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: EventFormField;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const describedBy =
    [hint ? `${name}-hint` : null, error ? `${name}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={name}>{label}</label>
      {hint ? (
        <p id={`${name}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <div data-described-by={describedBy}>{children}</div>
      {error ? (
        <p id={`${name}-error`} className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function EventForm({
  mode,
  action,
  initialValues,
  slugLocked = false,
  cancelHref,
}: EventFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const errors = state.fieldErrors ?? {};
  const v = initialValues;

  // Auto-slug: while the event is private and its slug is still the
  // system-generated `draft-xxxxxxxx` placeholder a submission conversion
  // assigns, keep the slug in sync with the title as the curator types one.
  // The moment the curator edits the slug field directly, `autoSlug` turns
  // off for the rest of this page's lifetime, so their choice is never
  // overwritten by a later title edit. Once published (`slugLocked`), this
  // never engages at all — the slug field behaves exactly as before.
  const [slugValue, setSlugValue] = useState(v.slug);
  const [autoSlug, setAutoSlug] = useState(
    !slugLocked && DRAFT_SLUG_PLACEHOLDER_RE.test(v.slug),
  );

  function handleTitleChange(event: ChangeEvent<HTMLInputElement>) {
    if (!autoSlug) return;
    const generated = slugify(event.target.value);
    // A blank (or punctuation-only) title leaves the current draft slug
    // untouched rather than clearing it.
    if (generated) setSlugValue(generated);
  }

  function handleSlugChange(event: ChangeEvent<HTMLInputElement>) {
    setAutoSlug(false);
    setSlugValue(event.target.value);
  }

  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.ok === false && state.message ? (
        <p className={styles.formError} role="alert">
          {state.message}
        </p>
      ) : null}

      <fieldset className={styles.group}>
        <legend>Identity</legend>

        <Field
          name="slug"
          label="Slug"
          hint={
            slugLocked
              ? "Locked — this event has already been published, so its citable slug cannot change."
              : "Lower-case words separated by single hyphens. This becomes the public URL and is fixed once the event is published."
          }
          error={errors.slug}
        >
          <input
            id="slug"
            name="slug"
            type="text"
            value={slugValue}
            onChange={handleSlugChange}
            readOnly={slugLocked}
            spellCheck={false}
            autoCapitalize="none"
          />
        </Field>

        <Field name="title" label="Title" error={errors.title}>
          <input
            id="title"
            name="title"
            type="text"
            defaultValue={v.title}
            onChange={handleTitleChange}
          />
        </Field>

        <Field
          name="summary"
          label="Summary"
          hint="A neutral description of what happened. Roughly 60 words."
          error={errors.summary}
        >
          <textarea id="summary" name="summary" rows={3} defaultValue={v.summary} />
        </Field>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>When &amp; where</legend>

        <Field
          name="occurredOnPrecision"
          label="Date precision"
          hint="How precisely the date is known. Choose Unknown to leave the date blank."
          error={errors.occurredOnPrecision}
        >
          <select
            id="occurredOnPrecision"
            name="occurredOnPrecision"
            defaultValue={v.occurredOnPrecision}
          >
            {OCCURRED_ON_PRECISION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {occurredOnPrecisionLabel(option)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="occurredOn"
          label="Date occurred"
          hint="For Month precision the day is ignored; for Year precision the month and day are ignored."
          error={errors.occurredOn}
        >
          <input
            id="occurredOn"
            name="occurredOn"
            type="date"
            defaultValue={v.occurredOn}
          />
        </Field>

        <Field
          name="locationText"
          label="Location (as described by sources)"
          hint="Optional. e.g. San Francisco, California, USA."
          error={errors.locationText}
        >
          <input
            id="locationText"
            name="locationText"
            type="text"
            defaultValue={v.locationText}
          />
        </Field>

        <Field
          name="locationCountryCode"
          label="Country code"
          hint="Optional. Two-letter ISO code, e.g. US."
          error={errors.locationCountryCode}
        >
          <input
            id="locationCountryCode"
            name="locationCountryCode"
            type="text"
            maxLength={2}
            defaultValue={v.locationCountryCode}
            className={styles.short}
            style={{ textTransform: "uppercase" }}
          />
        </Field>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>System</legend>

        <Field
          name="developerOrOperator"
          label="Developer or operator"
          hint="Named as the sources name it; not canonicalised."
          error={errors.developerOrOperator}
        >
          <input
            id="developerOrOperator"
            name="developerOrOperator"
            type="text"
            defaultValue={v.developerOrOperator}
          />
        </Field>

        <Field
          name="systemName"
          label="System name"
          hint="Optional. e.g. FSD (Supervised), Waymo Driver."
          error={errors.systemName}
        >
          <input
            id="systemName"
            name="systemName"
            type="text"
            defaultValue={v.systemName}
          />
        </Field>

        <Field
          name="automationStatus"
          label="Automation status"
          hint="Whether the driving-automation feature was engaged. Independent of cause."
          error={errors.automationStatus}
        >
          <select
            id="automationStatus"
            name="automationStatus"
            defaultValue={v.automationStatus}
          >
            {AUTOMATION_STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {automationStatusLabel(option)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="systemVersion"
          label="System version"
          hint="Optional. Only record a version a source actually states or approximates."
          error={errors.systemVersion}
        >
          <input
            id="systemVersion"
            name="systemVersion"
            type="text"
            defaultValue={v.systemVersion}
          />
        </Field>

        <Field
          name="systemVersionKnowledge"
          label="Version knowledge"
          hint="If a version is given above, this must be Stated or Approximate."
          error={errors.systemVersionKnowledge}
        >
          <select
            id="systemVersionKnowledge"
            name="systemVersionKnowledge"
            defaultValue={v.systemVersionKnowledge}
          >
            {SYSTEM_VERSION_KNOWLEDGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {systemVersionKnowledgeLabel(option)}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Classification</legend>

        <Field name="eventType" label="Event type" error={errors.eventType}>
          <select id="eventType" name="eventType" defaultValue={v.eventType}>
            <option value="">— choose —</option>
            {EVENT_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {eventTypeLabel(option)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="valence"
          label="Outcome"
          hint="Not cross-checked against the event type."
          error={errors.valence}
        >
          <select id="valence" name="valence" defaultValue={v.valence}>
            <option value="">— choose —</option>
            {VALENCE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {valenceLabel(option)}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Findings</legend>

        <Field
          name="observedFacts"
          label="Observed facts"
          hint="One per line. Neutral statements directly supported by the sources."
          error={errors.observedFacts}
        >
          <textarea
            id="observedFacts"
            name="observedFacts"
            rows={5}
            defaultValue={v.observedFacts}
          />
        </Field>

        <Field
          name="unknowns"
          label="Unknowns"
          hint="One per line. Specific facts the sources do NOT establish. Never inferred."
          error={errors.unknowns}
        >
          <textarea
            id="unknowns"
            name="unknowns"
            rows={4}
            defaultValue={v.unknowns}
          />
        </Field>

        <Field
          name="interpretation"
          label="Interpretation"
          hint="Optional. Curator interpretation beyond direct observation; shown separately and labelled."
          error={errors.interpretation}
        >
          <textarea
            id="interpretation"
            name="interpretation"
            rows={3}
            defaultValue={v.interpretation}
          />
        </Field>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Assessment</legend>

        <Field
          name="causationStatus"
          label="Causation status"
          hint="Involvement of an automation system is not by itself a cause. Leave as Undetermined unless a source supports more."
          error={errors.causationStatus}
        >
          <select
            id="causationStatus"
            name="causationStatus"
            defaultValue={v.causationStatus}
          >
            {CAUSATION_STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {causationStatusLabel(option)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="causationNote"
          label="Causation note"
          hint="Optional. Required reasoning if causation is anything other than Undetermined."
          error={errors.causationNote}
        >
          <textarea
            id="causationNote"
            name="causationNote"
            rows={2}
            defaultValue={v.causationNote}
          />
        </Field>

        <Field
          name="reviewStatus"
          label="Review status"
          hint="A deliberate choice — there is no default."
          error={errors.reviewStatus}
        >
          <select
            id="reviewStatus"
            name="reviewStatus"
            defaultValue={v.reviewStatus}
          >
            <option value="">— choose —</option>
            {REVIEW_STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {reviewStatusLabel(option)}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Record</legend>

        <Field
          name="recordUpdated"
          label="Record updated"
          hint="The editorial date this record was last reviewed or changed. Not the system timestamp."
          error={errors.recordUpdated}
        >
          <input
            id="recordUpdated"
            name="recordUpdated"
            type="date"
            defaultValue={v.recordUpdated}
          />
        </Field>
      </fieldset>

      <div className={styles.actions}>
        <button type="submit" className={styles.submit} disabled={pending}>
          {pending
            ? "Saving…"
            : mode === "create"
              ? "Create draft"
              : "Save changes"}
        </button>
        <Link href={cancelHref} className={styles.cancel}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

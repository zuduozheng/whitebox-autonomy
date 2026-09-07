"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ReactNode } from "react";

import {
  OCCURRED_ON_PRECISION_OPTIONS,
  SOURCE_TYPE_OPTIONS,
  occurredOnPrecisionLabel,
  sourceTypeLabel,
} from "@/lib/events/labels";
import {
  INITIAL_SOURCE_FORM_STATE,
  type SourceFormField,
  type SourceFormState,
  type SourceFormValues,
} from "@/lib/admin/source-form";

import styles from "./EventForm.module.css";

type FormAction = (
  prevState: SourceFormState,
  formData: FormData,
) => Promise<SourceFormState>;

interface SourceFormProps {
  action: FormAction;
  initialValues: SourceFormValues;
  submitLabel: string;
  pendingLabel: string;
  cancelHref: string;
}

function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: SourceFormField;
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

export default function SourceForm({
  action,
  initialValues,
  submitLabel,
  pendingLabel,
  cancelHref,
}: SourceFormProps) {
  const [state, formAction, pending] = useActionState(
    action,
    INITIAL_SOURCE_FORM_STATE,
  );
  const errors = state.fieldErrors ?? {};
  const v = initialValues;

  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.ok === false && state.message ? (
        <p className={styles.formError} role="alert">
          {state.message}
        </p>
      ) : null}

      <fieldset className={styles.group}>
        <legend>Source</legend>

        <Field
          name="url"
          label="URL"
          hint="Canonical link to the source. Must start with http:// or https://."
          error={errors.url}
        >
          <input
            id="url"
            name="url"
            type="url"
            defaultValue={v.url}
            spellCheck={false}
            autoCapitalize="none"
          />
        </Field>

        <Field name="sourceType" label="Source type" error={errors.sourceType}>
          <select id="sourceType" name="sourceType" defaultValue={v.sourceType}>
            <option value="">— choose —</option>
            {SOURCE_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {sourceTypeLabel(option)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="publisher"
          label="Publisher"
          hint="Optional. Outlet / organisation / account responsible for the source."
          error={errors.publisher}
        >
          <input
            id="publisher"
            name="publisher"
            type="text"
            defaultValue={v.publisher}
          />
        </Field>

        <Field
          name="label"
          label="Link text"
          hint="Optional. Curator-written short link text — not a copied headline or caption."
          error={errors.label}
        >
          <input id="label" name="label" type="text" defaultValue={v.label} />
        </Field>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Dates</legend>

        <Field
          name="publishedOnPrecision"
          label="Published-date precision"
          hint="How precisely the publication date is known. Choose Unknown to leave it blank."
          error={errors.publishedOnPrecision}
        >
          <select
            id="publishedOnPrecision"
            name="publishedOnPrecision"
            defaultValue={v.publishedOnPrecision}
          >
            {OCCURRED_ON_PRECISION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {occurredOnPrecisionLabel(option)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="publishedOn"
          label="Published on"
          hint="For Month precision the day is ignored; for Year precision the month and day are ignored."
          error={errors.publishedOn}
        >
          <input
            id="publishedOn"
            name="publishedOn"
            type="date"
            defaultValue={v.publishedOn}
          />
        </Field>

        <Field
          name="retrievedOn"
          label="Retrieved on"
          hint="Optional. The date you last checked this link."
          error={errors.retrievedOn}
        >
          <input
            id="retrievedOn"
            name="retrievedOn"
            type="date"
            defaultValue={v.retrievedOn}
          />
        </Field>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Note</legend>

        <Field
          name="note"
          label="Note"
          hint="Optional. One neutral sentence on what this source shows. Not a transcript or quote."
          error={errors.note}
        >
          <textarea id="note" name="note" rows={2} defaultValue={v.note} />
        </Field>
      </fieldset>

      <div className={styles.actions}>
        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        <Link href={cancelHref} className={styles.cancel}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

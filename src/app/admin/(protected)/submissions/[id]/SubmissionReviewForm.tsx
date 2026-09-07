"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

import {
  INITIAL_SUBMISSION_REVIEW_STATE,
  SUBMISSION_STATUS_OPTIONS,
  submissionStatusLabel,
  type SubmissionReviewFormField,
  type SubmissionReviewFormState,
  type SubmissionStatus,
} from "@/lib/submissions/submission-review";

import styles from "@/app/admin/(protected)/events/EventForm.module.css";

type FormAction = (
  prevState: SubmissionReviewFormState,
  formData: FormData,
) => Promise<SubmissionReviewFormState>;

interface SubmissionReviewFormProps {
  action: FormAction;
  initialStatus: SubmissionStatus;
  initialCuratorNote: string;
}

function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: SubmissionReviewFormField;
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

export default function SubmissionReviewForm({
  action,
  initialStatus,
  initialCuratorNote,
}: SubmissionReviewFormProps) {
  const [state, formAction, pending] = useActionState(
    action,
    INITIAL_SUBMISSION_REVIEW_STATE,
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.ok === false && state.message ? (
        <p className={styles.formError} role="alert">
          {state.message}
        </p>
      ) : null}

      <fieldset className={styles.group}>
        <legend>Curator review</legend>

        <Field
          name="status"
          label="Status"
          hint="Setting the status back to Pending clears the recorded reviewer and time."
          error={errors.status}
        >
          <select id="status" name="status" defaultValue={initialStatus}>
            {SUBMISSION_STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {submissionStatusLabel(option)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="curatorNote"
          label="Curator note"
          hint="Optional. Curator-written context for this submission, kept separate from the submitted information. Up to 4000 characters."
          error={errors.curatorNote}
        >
          <textarea
            id="curatorNote"
            name="curatorNote"
            rows={4}
            defaultValue={initialCuratorNote}
          />
        </Field>
      </fieldset>

      <div className={styles.actions}>
        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? "Saving…" : "Save review"}
        </button>
      </div>
    </form>
  );
}

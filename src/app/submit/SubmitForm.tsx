"use client";

import { cloneElement, isValidElement, useActionState } from "react";
import type { ReactNode } from "react";

import {
  HONEYPOT_FIELD,
  INITIAL_SUBMISSION_FORM_STATE,
  type SubmissionFormField,
  type SubmissionFormState,
} from "@/lib/submissions/submission-form";

import styles from "./SubmitForm.module.css";

type FormAction = (
  prevState: SubmissionFormState,
  formData: FormData,
) => Promise<SubmissionFormState>;

function Field({
  name,
  label,
  hint,
  error,
  optional,
  children,
}: {
  name: SubmissionFormField;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  const describedBy =
    [hint ? `${name}-hint` : null, error ? `${name}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  // Associate the hint/error text with the real control (always a single
  // <input> / <textarea>) via aria-describedby, merging any value it already
  // carries.
  const control =
    isValidElement<{ "aria-describedby"?: string }>(children) && describedBy
      ? cloneElement(children, {
          "aria-describedby":
            [children.props["aria-describedby"], describedBy]
              .filter(Boolean)
              .join(" ") || undefined,
        })
      : children;

  return (
    <div className={styles.field}>
      <label htmlFor={name}>
        {label}
        {optional ? <span className={styles.optional}> (optional)</span> : null}
      </label>
      {hint ? (
        <p id={`${name}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <div>{control}</div>
      {error ? (
        <p id={`${name}-error`} className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function SubmitForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(
    action,
    INITIAL_SUBMISSION_FORM_STATE,
  );
  const errors = state.fieldErrors ?? {};

  if (state.ok === true) {
    return (
      <div className={styles.success} role="status">
        <h2 className={styles.successHeading}>Submission received</h2>
        <p>
          Thank you. A curator will review this submission. Not every submission
          results in an entry in the Observatory.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.ok === false && state.message ? (
        <p className={styles.formError} role="alert">
          {state.message}
        </p>
      ) : null}

      <Field
        name="evidenceUrl"
        label="Link to the event video or evidence"
        hint="A public link to the specific video or report showing this event. Must start with http:// or https://."
        error={errors.evidenceUrl}
      >
        <input
          id="evidenceUrl"
          name="evidenceUrl"
          type="url"
          inputMode="url"
          spellCheck={false}
          autoCapitalize="none"
          required
        />
      </Field>

      <Field
        name="whatHappened"
        label="What happened"
        optional
        hint="A brief, factual description in your own words. Leave blank if the link speaks for itself."
        error={errors.whatHappened}
      >
        <textarea
          id="whatHappened"
          name="whatHappened"
          rows={4}
          maxLength={4000}
        />
      </Field>

      <Field
        name="developerOrOperator"
        label="Developer or operator"
        optional
        hint="The company running the automated-driving system, if you know it."
        error={errors.developerOrOperator}
      >
        <input
          id="developerOrOperator"
          name="developerOrOperator"
          type="text"
          maxLength={200}
        />
      </Field>

      <Field
        name="locationText"
        label="Location"
        optional
        hint="Where it happened, as plainly as you can say it — for example, a city and street."
        error={errors.locationText}
      >
        <input
          id="locationText"
          name="locationText"
          type="text"
          maxLength={500}
        />
      </Field>

      <Field
        name="eventDate"
        label="Date of the event"
        optional
        hint="Only if you are sure. If the date is unknown, leave this blank — please do not estimate."
        error={errors.eventDate}
      >
        <input id="eventDate" name="eventDate" type="date" />
      </Field>

      <Field
        name="additionalUrls"
        label="Additional links"
        optional
        hint="Any other public links about the same event, one per line."
        error={errors.additionalUrls}
      >
        <textarea
          id="additionalUrls"
          name="additionalUrls"
          rows={3}
          maxLength={4000}
        />
      </Field>

      <Field
        name="submitterEmail"
        label="Your email"
        optional
        hint="Used only so a curator can follow up on this submission. It is never published."
        error={errors.submitterEmail}
      >
        <input
          id="submitterEmail"
          name="submitterEmail"
          type="email"
          autoComplete="email"
          maxLength={320}
          spellCheck={false}
          autoCapitalize="none"
        />
      </Field>

      {/*
        Anti-spam honeypot. Hidden from people and assistive technology; a real
        submission always leaves this empty. Its value is inspected in the Server
        Action and is never written to the database.
      */}
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor={HONEYPOT_FIELD}>Company</label>
        <input
          id={HONEYPOT_FIELD}
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className={styles.actions}>
        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? "Sending…" : "Send submission"}
        </button>
      </div>
    </form>
  );
}

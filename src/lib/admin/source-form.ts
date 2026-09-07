/**
 * Admin source form — shared, side-effect-free logic used by both the client
 * form component and the server action.
 *
 * Contains NO database access, NO secrets and NO server-only imports, so it is
 * safe to import from a Client Component. Parsing/validation of the submitted
 * FormData happens here and is re-run authoritatively inside the server action;
 * the browser is never trusted.
 *
 * The write model here mirrors every CHECK constraint on `public.event_source`
 * (see supabase/migrations/20260829235332_observatory_core.sql) so a valid parse
 * should never be rejected by the database for a content reason. `event_id` is
 * deliberately NOT a field here: it is derived from the route context by the
 * data layer, never supplied by the browser.
 */

import {
  OCCURRED_ON_PRECISION_OPTIONS,
  SOURCE_TYPE_OPTIONS,
} from "@/lib/events/labels";
import type { DatePrecision, SourceType } from "@/lib/events/types";

/** Every field name on the source form. Keys both inputs and field errors. */
export type SourceFormField =
  | "url"
  | "sourceType"
  | "publisher"
  | "label"
  | "publishedOn"
  | "publishedOnPrecision"
  | "retrievedOn"
  | "note";

export type SourceFieldErrors = Partial<Record<SourceFormField, string>>;

/** Result of the source server action, consumed by useActionState. */
export interface SourceFormState {
  /** null = untouched; false = rejected. Success paths redirect instead. */
  ok: boolean | null;
  message?: string;
  fieldErrors?: SourceFieldErrors;
}

export const INITIAL_SOURCE_FORM_STATE: SourceFormState = { ok: null };

/** Raw string shape the form renders. `""` means "not provided". */
export interface SourceFormValues {
  url: string;
  sourceType: SourceType | "";
  publisher: string;
  label: string;
  publishedOn: string;
  publishedOnPrecision: DatePrecision;
  retrievedOn: string;
  note: string;
}

/** Validated, database-shaped input. Nulls where a column is absent. */
export interface SourceWriteInput {
  url: string;
  sourceType: SourceType;
  publisher: string | null;
  label: string | null;
  publishedOn: string | null;
  publishedOnPrecision: DatePrecision;
  retrievedOn: string | null;
  note: string | null;
}

/** Blank form for the "add source" page. */
export function emptySourceFormValues(): SourceFormValues {
  return {
    url: "",
    sourceType: "",
    publisher: "",
    label: "",
    publishedOn: "",
    publishedOnPrecision: "unknown",
    retrievedOn: "",
    note: "",
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function includes<T extends string>(
  options: readonly T[],
  value: string,
): value is T {
  return (options as readonly string[]).includes(value);
}

/**
 * Parse + validate submitted FormData. Returns the database-shaped input on
 * success, or a map of per-field messages on failure.
 */
export function parseSourceForm(
  formData: FormData,
):
  | { ok: true; data: SourceWriteInput }
  | { ok: false; fieldErrors: SourceFieldErrors } {
  const errors: SourceFieldErrors = {};

  const url = field(formData, "url").trim();
  if (!url) {
    errors.url = "Enter the source URL.";
  } else if (!/^https?:\/\//i.test(url)) {
    errors.url = "The URL must start with http:// or https://.";
  } else {
    try {
      new URL(url);
    } catch {
      errors.url = "Enter a valid URL.";
    }
  }

  const sourceTypeRaw = field(formData, "sourceType").trim();
  if (!includes(SOURCE_TYPE_OPTIONS, sourceTypeRaw)) {
    errors.sourceType = "Choose a source type.";
  }

  const publisher = nullIfEmpty(field(formData, "publisher"));
  const label = nullIfEmpty(field(formData, "label"));
  const note = nullIfEmpty(field(formData, "note"));

  const publishedOnPrecisionRaw = field(formData, "publishedOnPrecision").trim();
  const publishedOnPrecision: DatePrecision = includes(
    OCCURRED_ON_PRECISION_OPTIONS,
    publishedOnPrecisionRaw,
  )
    ? publishedOnPrecisionRaw
    : "unknown";
  if (!includes(OCCURRED_ON_PRECISION_OPTIONS, publishedOnPrecisionRaw)) {
    errors.publishedOnPrecision = "Choose a date precision.";
  }

  const publishedOnRaw = field(formData, "publishedOn").trim();
  let publishedOn: string | null = null;
  if (publishedOnPrecision !== "unknown") {
    if (!ISO_DATE_RE.test(publishedOnRaw)) {
      errors.publishedOn = "Enter the date the source was published.";
    } else {
      const [year, month] = publishedOnRaw.split("-");
      publishedOn =
        publishedOnPrecision === "year"
          ? `${year}-01-01`
          : publishedOnPrecision === "month"
            ? `${year}-${month}-01`
            : publishedOnRaw;
    }
  }

  const retrievedOnRaw = field(formData, "retrievedOn").trim();
  let retrievedOn: string | null = null;
  if (retrievedOnRaw) {
    if (!ISO_DATE_RE.test(retrievedOnRaw)) {
      errors.retrievedOn = "Enter a valid date, or leave this blank.";
    } else {
      retrievedOn = retrievedOnRaw;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }

  return {
    ok: true,
    data: {
      url,
      sourceType: sourceTypeRaw as SourceType,
      publisher,
      label,
      publishedOn,
      publishedOnPrecision,
      retrievedOn,
      note,
    },
  };
}

/**
 * Map validated input to the exact set of `public.event_source` columns the
 * admin form is allowed to write. `event_id` and the audit columns
 * (`created_by`, `updated_by`, `created_at`, `updated_at`) are deliberately
 * absent — `event_id` is added by the data layer from the route context, and
 * the database owns the rest.
 */
export function sourceInputToColumns(input: SourceWriteInput) {
  return {
    url: input.url,
    source_type: input.sourceType,
    publisher: input.publisher,
    label: input.label,
    published_on: input.publishedOn,
    published_on_precision: input.publishedOnPrecision,
    retrieved_on: input.retrievedOn,
    note: input.note,
  };
}

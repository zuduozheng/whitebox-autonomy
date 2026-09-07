/**
 * Human-readable labels for the event-model enums, plus the ordered option
 * lists used by filters and (later) admin forms. Kept separate from `types.ts`
 * so display wording can change without touching the data contract.
 */

import type {
  AutomationStatus,
  CausationStatus,
  DatePrecision,
  EventType,
  LocationPrecision,
  Origin,
  ReviewStatus,
  SourceType,
  SystemVersionKnowledge,
  Valence,
} from "./types";

export const EVENT_TYPE_OPTIONS = [
  "collision",
  "near-miss-or-safety-critical",
  "unexpected-or-inappropriate-behaviour",
  "unnecessary-stop-braking-or-hesitation",
  "traffic-rule-or-infrastructure-interpretation",
  "vulnerable-road-user-interaction",
  "emergency-vehicle-interaction",
  "traffic-disruption-or-obstruction",
  "successful-challenging-interaction",
  "other",
] as const satisfies readonly EventType[];

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  "collision": "Collision",
  "near-miss-or-safety-critical": "Near miss / safety-critical interaction",
  "unexpected-or-inappropriate-behaviour": "Unexpected or inappropriate behaviour",
  "unnecessary-stop-braking-or-hesitation":
    "Unnecessary stop / braking / hesitation",
  "traffic-rule-or-infrastructure-interpretation":
    "Traffic-rule or infrastructure interpretation",
  "vulnerable-road-user-interaction":
    "Pedestrian / cyclist / vulnerable-road-user interaction",
  "emergency-vehicle-interaction": "Emergency-vehicle interaction",
  "traffic-disruption-or-obstruction": "Traffic disruption / obstruction",
  "successful-challenging-interaction": "Successful challenging interaction",
  "other": "Other",
};

export function eventTypeLabel(value: EventType): string {
  return EVENT_TYPE_LABELS[value];
}

export const VALENCE_OPTIONS = [
  "failure-or-challenging",
  "successful-handling",
  "neutral-or-unclear",
] as const satisfies readonly Valence[];

const VALENCE_LABELS: Record<Valence, string> = {
  "failure-or-challenging": "Failure / challenging",
  "successful-handling": "Successful handling of a difficult situation",
  "neutral-or-unclear": "Neutral / unclear",
};

export function valenceLabel(value: Valence): string {
  return VALENCE_LABELS[value];
}

/**
 * Short, card-only display wording for {@link Valence}. Presentation layer only:
 * these do NOT replace VALENCE_LABELS (used on the event detail page and as the
 * Observatory filter option text) and have no effect on the valence values, the
 * taxonomy, the stored representation, or filtering.
 */
const VALENCE_SHORT_LABELS: Record<Valence, string> = {
  "failure-or-challenging": "Failure / challenging",
  "successful-handling": "Successful handling",
  "neutral-or-unclear": "Neutral / unclear",
};

export function valenceShortLabel(value: Valence): string {
  return VALENCE_SHORT_LABELS[value];
}

export const AUTOMATION_STATUS_OPTIONS = [
  "driving-automation-engaged-confirmed",
  "driving-automation-engaged-reported",
  "driving-automation-status-uncertain",
  "driving-automation-not-engaged",
  "unknown",
] as const satisfies readonly AutomationStatus[];

const AUTOMATION_STATUS_LABELS: Record<AutomationStatus, string> = {
  "driving-automation-engaged-confirmed":
    "Driving automation engaged — confirmed",
  "driving-automation-engaged-reported":
    "Driving automation engaged — reported, not confirmed",
  "driving-automation-status-uncertain": "Driving automation status uncertain",
  "driving-automation-not-engaged": "Driving automation not engaged",
  "unknown": "Unknown",
};

export function automationStatusLabel(value: AutomationStatus): string {
  return AUTOMATION_STATUS_LABELS[value];
}

export const CAUSATION_STATUS_OPTIONS = [
  "undetermined",
  "automation-system-contributed",
  "other-party-contributed",
  "shared-or-multiple-factors",
  "not-applicable",
] as const satisfies readonly CausationStatus[];

const CAUSATION_STATUS_LABELS: Record<CausationStatus, string> = {
  "undetermined": "Undetermined",
  "automation-system-contributed": "Automation system contributed",
  "other-party-contributed": "Another party contributed",
  "shared-or-multiple-factors": "Shared / multiple factors",
  "not-applicable": "Not applicable",
};

export function causationStatusLabel(value: CausationStatus): string {
  return CAUSATION_STATUS_LABELS[value];
}

export const REVIEW_STATUS_OPTIONS = [
  "curator-reviewed",
  "verified",
  "disputed",
] as const satisfies readonly ReviewStatus[];

const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  "curator-reviewed": "Curator-reviewed",
  "verified": "Verified",
  "disputed": "Disputed",
};

export function reviewStatusLabel(value: ReviewStatus): string {
  return REVIEW_STATUS_LABELS[value];
}

/**
 * No `ORIGIN_OPTIONS`/form usage deliberately: origin is never manually
 * selectable (see EventForm.tsx / event-form.ts) — it is set only by the
 * database default ('curated') or by the NHTSA publication pipeline. This is
 * label lookup only.
 */
const ORIGIN_LABELS: Record<Origin, string> = {
  "curated": "Curated",
  "source-derived": "Source-derived",
};

export function originLabel(value: Origin): string {
  return ORIGIN_LABELS[value];
}

export const OCCURRED_ON_PRECISION_OPTIONS = [
  "day",
  "month",
  "year",
  "unknown",
] as const satisfies readonly DatePrecision[];

const OCCURRED_ON_PRECISION_LABELS: Record<DatePrecision, string> = {
  "day": "Exact day",
  "month": "Month only",
  "year": "Year only",
  "unknown": "Unknown",
};

export function occurredOnPrecisionLabel(value: DatePrecision): string {
  return OCCURRED_ON_PRECISION_LABELS[value];
}

/**
 * No `LOCATION_PRECISION_OPTIONS`/form usage deliberately, same reasoning as
 * `ORIGIN_LABELS` above: not yet wired into the admin form (out of scope for
 * this slice). Label lookup only, for the public page's precision qualifier.
 */
const LOCATION_PRECISION_LABELS: Record<LocationPrecision, string> = {
  "exact-point": "Exact location",
  "road-or-intersection": "Road or intersection level",
  "local-area": "Local area level",
  "city": "City level",
  "region": "Region level",
  "country": "Country level",
  "unknown": "Precision unknown",
};

export function locationPrecisionLabel(value: LocationPrecision): string {
  return LOCATION_PRECISION_LABELS[value];
}

export const SYSTEM_VERSION_KNOWLEDGE_OPTIONS = [
  "stated",
  "approximate",
  "unknown",
] as const satisfies readonly SystemVersionKnowledge[];

const SYSTEM_VERSION_KNOWLEDGE_LABELS: Record<SystemVersionKnowledge, string> = {
  "stated": "Stated by a source",
  "approximate": "Approximate",
  "unknown": "Unknown",
};

export function systemVersionKnowledgeLabel(
  value: SystemVersionKnowledge,
): string {
  return SYSTEM_VERSION_KNOWLEDGE_LABELS[value];
}

export const SOURCE_TYPE_OPTIONS = [
  "x-post",
  "youtube-video",
  "news-article",
  "official-report",
  "regulatory-record",
  "other",
] as const satisfies readonly SourceType[];

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  "x-post": "X post",
  "youtube-video": "YouTube video",
  "news-article": "News article",
  "official-report": "Official report",
  "regulatory-record": "Regulatory record",
  "other": "Other",
};

export function sourceTypeLabel(value: SourceType): string {
  return SOURCE_TYPE_LABELS[value];
}

/**
 * Observatory event model — Step 3.
 *
 * Deliberately small: a hand-authored local dataset that validates the public
 * Observatory experience before any database or AI-assisted discovery. These
 * are plain, storage-agnostic TypeScript types — no ORM, no framework imports —
 * so the same shapes can back a Supabase source later without UI changes.
 *
 * Scientific principles encoded here:
 *  - sources are the evidence; summaries and interpretation are not;
 *  - unknown information stays explicit (`unknowns`), never inferred;
 *  - observation (`observedFacts`) is separated from interpretation;
 *  - involvement of a driving-automation system is not the same as causation
 *    (`causation.status` defaults to "undetermined");
 *  - a software/system version is recorded only where a source states one.
 */

/**
 * A date known only to a given precision. `value` is an ISO-8601 fragment:
 * "2024-05-17" (day), "2024-05" (month), "2024" (year). When precision is
 * "unknown", `value` is an empty string and the UI shows "Date unknown".
 */
export interface PartialDate {
  value: string;
  precision: "day" | "month" | "year" | "unknown";
}

/**
 * What is known about whether the driving-automation feature was engaged.
 * Implies nothing about the system's SAE automation level.
 */
export type AutomationStatus =
  | "driving-automation-engaged-confirmed"
  | "driving-automation-engaged-reported"
  | "driving-automation-status-uncertain"
  | "driving-automation-not-engaged"
  | "unknown";

export interface SystemVersion {
  /** Verbatim version string — present only if one appears in a source. */
  value?: string;
  knowledge: "stated" | "approximate" | "unknown";
}

/** Precision of a {@link PartialDate}. Named alias for reuse by forms/queries. */
export type DatePrecision = PartialDate["precision"];

/** How well a {@link SystemVersion} string is known. Named alias for reuse. */
export type SystemVersionKnowledge = SystemVersion["knowledge"];

export type EventType =
  | "collision"
  | "near-miss-or-safety-critical"
  | "unexpected-or-inappropriate-behaviour"
  | "unnecessary-stop-braking-or-hesitation"
  | "traffic-rule-or-infrastructure-interpretation"
  | "vulnerable-road-user-interaction"
  | "emergency-vehicle-interaction"
  | "traffic-disruption-or-obstruction"
  | "successful-challenging-interaction"
  | "other";

export type Valence =
  | "failure-or-challenging"
  | "successful-handling"
  | "neutral-or-unclear";

export type CausationStatus =
  | "undetermined"
  | "automation-system-contributed"
  | "other-party-contributed"
  | "shared-or-multiple-factors"
  | "not-applicable";

export interface Causation {
  /**
   * Defaults to "undetermined". Any stronger value requires supporting evidence
   * summarised in `note`. Involvement of a driving-automation system is never by
   * itself a cause.
   */
  status: CausationStatus;
  note?: string;
}

/**
 * Standing of the Observatory record — NOT a rating of the intrinsic strength
 * of its evidence. A separate evidence-quality field may be added in a later
 * step. Wording matches the `/methodology` page.
 *
 * Independent of {@link Origin}: this is a curator's incident-level judgement,
 * optional and settable at any time; origin is a fixed fact about how the
 * record was created. A `source-derived` event may have `reviewStatus: null`
 * forever, or may later genuinely acquire one without its origin changing.
 */
export type ReviewStatus = "curator-reviewed" | "verified" | "disputed";

/**
 * How this WBA event record was created — a fact fixed at creation time,
 * never a curator judgement. See {@link ReviewStatus} for the independent,
 * optional, incident-level review dimension.
 *
 *  - "curated": a curator authored or individually reviewed this record
 *    before it could become public. Every event has this origin unless the
 *    database explicitly says otherwise.
 *  - "source-derived": created by a validated, deterministic transformation
 *    of one or more identified regulatory source records, without
 *    incident-by-incident curator review. Not a claim of lower quality or of
 *    independent verification of the underlying physical incident — see
 *    `/methodology`.
 */
export type Origin = "curated" | "source-derived";

export type SourceType =
  | "x-post"
  | "youtube-video"
  | "news-article"
  | "official-report"
  | "regulatory-record"
  | "other";

export interface Source {
  /** Canonical link to the source artifact. */
  url: string;
  type: SourceType;
  /** Organisation / outlet / account responsible for the source. */
  publisher?: string;
  /** Curator-written short link text. Not a copied caption or headline. */
  label?: string;
  publishedOn?: PartialDate;
  /** ISO date (YYYY-MM-DD) the curator last retrieved / checked the link. */
  retrievedOn?: string;
  /** One neutral sentence on what this source shows. Not a transcript or quote. */
  note?: string;
}

/**
 * How precisely a location is known. NHTSA-derived locations never exceed
 * "city" — this lets the UI say so rather than visually implying an exact
 * point it doesn't have.
 */
export type LocationPrecision =
  | "exact-point"
  | "road-or-intersection"
  | "local-area"
  | "city"
  | "region"
  | "country"
  | "unknown";

export interface EventLocation {
  /** Place as described by the sources, e.g. "San Francisco, California, USA". */
  text: string;
  /** ISO 3166-1 alpha-2, where known. */
  countryCode?: string;
  precision: LocationPrecision;
}

export interface Event {
  /** Stable, citable URL identifier. Immutable once published. */
  slug: string;
  /** Neutral descriptive headline. Never evaluative. */
  title: string;
  /**
   * Curator-written neutral summary of what happened (roughly <= 60 words).
   * `null` for a `source-derived` event that has none — never a fabricated
   * placeholder; the public page relies on structured fields and sources
   * instead. Always non-null for a `curated` event.
   */
  summary: string | null;
  occurredOn: PartialDate;
  location?: EventLocation;

  /**
   * Company operating or that developed the driving-automation system, as named
   * by sources. Free text; never auto-canonicalised.
   */
  developerOrOperator: string;
  /** Product / feature name if stated (e.g. "Waymo Driver", "FSD (Supervised)"). */
  systemName?: string;
  automationStatus: AutomationStatus;
  systemVersion?: SystemVersion;

  eventType: EventType;
  valence: Valence;

  /** Concise, neutral statements directly supported by the linked sources. */
  observedFacts: string[];
  /** Specific facts the sources do NOT establish. Never inferred fill. */
  unknowns: string[];
  /**
   * Optional curator interpretation that goes beyond direct observation.
   * Rendered separately and explicitly labelled. Omit if none.
   */
  interpretation?: string;

  causation: Causation;
  /**
   * `null` for a `source-derived` event with no incident-level curator
   * judgement yet. Always non-null for a `curated` event.
   */
  reviewStatus: ReviewStatus | null;

  /** How this record was created. See {@link Origin}. */
  origin: Origin;

  /** ISO date (YYYY-MM-DD) the record was last reviewed or changed. Required. */
  recordUpdated: string;

  /** One or more sources. The sources are the evidence. */
  sources: Source[];
}

/**
 * List-card projection. The Observatory list page depends only on this, never
 * on the full `Event`, so the list is insulated from event-model growth.
 */
export interface EventSummary {
  slug: string;
  title: string;
  occurredOn: PartialDate;
  developerOrOperator: string;
  systemName?: string;
  eventType: EventType;
  valence: Valence;
  reviewStatus: ReviewStatus | null;
  origin: Origin;
  sourceCount: number;
}

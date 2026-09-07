/**
 * The three Beta filters shared between Observatory (`/events`) and Map
 * (`/map`) — one filter model, one URL query-string shape, used identically
 * by both routes so switching between them preserves the same filtered
 * collection. See EventListFilter in repository.ts, which this deliberately
 * mirrors field-for-field (this module adds URL parsing/serialization on
 * top; it does not duplicate filtering logic itself).
 *
 * Parameter names are exactly the pre-existing Observatory names
 * (`eventType`, `valence`) plus one new one for this feature
 * (`developerOrOperator`) — never renamed for either page, so a URL built on
 * one route is valid, unmodified, on the other.
 *
 * `developerOrOperator`'s VALUE is the stable canonical operator (e.g.
 * "Waymo"), not one arbitrary raw spelling — see ./developer-operator.ts.
 * A URL carrying an old raw value (e.g. "Waymo LLC", generated before that
 * grouping existed) still resolves correctly via
 * resolveCanonicalDeveloperParam's backward-compatible fallback, without
 * needing two different parameter names or a redirect.
 */

import { resolveCanonicalDeveloperParam } from "./developer-operator.ts";
import { EVENT_TYPE_OPTIONS, VALENCE_OPTIONS } from "./labels.ts";
import type { EventType, Valence } from "./types";

export interface SharedEventFilter {
  eventType?: EventType;
  valence?: Valence;
  developerOrOperator?: string;
}

/** Shape Next.js passes as `searchParams` to a Server Component page. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function pickFromOptions<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const value = firstValue(raw);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Parses the three shared filters from a page's raw `searchParams`. An
 * unrecognized `eventType`/`valence` (outside the fixed enum) is silently
 * dropped — same "fall back to unfiltered" behavior the Observatory page
 * already used before this feature. `developerOrOperator` accepts either a
 * current canonical value or a known old raw value (resolved to its
 * canonical — see the module doc comment); anything else is dropped the
 * same way.
 */
export function parseSharedFilterParams(
  searchParams: RawSearchParams,
  developerOptions: readonly string[],
): SharedEventFilter {
  const developerOrOperatorRaw = firstValue(searchParams.developerOrOperator);
  return {
    eventType: pickFromOptions<EventType>(searchParams.eventType, EVENT_TYPE_OPTIONS),
    valence: pickFromOptions<Valence>(searchParams.valence, VALENCE_OPTIONS),
    developerOrOperator: developerOrOperatorRaw
      ? resolveCanonicalDeveloperParam(developerOrOperatorRaw, developerOptions)
      : undefined,
  };
}

export function isSharedFilterEmpty(filter: SharedEventFilter): boolean {
  return !filter.eventType && !filter.valence && !filter.developerOrOperator;
}

/**
 * Serializes the filter to a query string (no leading "?"; empty string
 * when no filter is active) — the single place both pages build the link
 * used to switch to the other view, and the one Map uses to keep its own
 * URL in sync as filters change.
 */
export function sharedFilterToQueryString(filter: SharedEventFilter): string {
  const params = new URLSearchParams();
  if (filter.eventType) params.set("eventType", filter.eventType);
  if (filter.valence) params.set("valence", filter.valence);
  if (filter.developerOrOperator) params.set("developerOrOperator", filter.developerOrOperator);
  return params.toString();
}

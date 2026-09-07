/**
 * Event data-access boundary.
 *
 * Pages and components import ONLY from this module (and `./types` / `./labels`).
 * Every function is async and returns plain typed objects, so the local
 * implementation can be replaced by a Supabase-backed one without changing a
 * single caller. Filtering and sorting live here today; they can move into SQL
 * later behind the same signatures.
 */

import { canonicalDeveloperLabel, EXCLUDED_DEVELOPER_RAW_VALUES } from "./developer-operator.ts";
import { parseSharedFilterParams, type RawSearchParams } from "./filter-params.ts";
import { partialDateSortKey } from "./format.ts";
// Active event source. Swap back to "./local-source" for an immediate rollback
// to the in-repo seed; every function below is agnostic to which one is used.
import { loadEvents } from "./supabase-source.ts";
import type { Event, EventSummary, EventType, Valence } from "./types";

export interface EventListFilter {
  eventType?: EventType;
  valence?: Valence;
  developerOrOperator?: string;
}

export interface ObservatoryStats {
  total: number;
  byValence: Record<Valence, number>;
}

/**
 * Fixed Beta page size for the Observatory list — no user-selectable
 * page-size control. Map is entirely unaffected: it has its own separate
 * cap (MAP_QUERY_CAP in map-repository.ts) for a different reason (bounding
 * a live viewport query, not paginating a browsable list) and this constant
 * is never imported there.
 */
export const OBSERVATORY_PAGE_SIZE = 50;

export interface EventsPageData {
  filter: EventListFilter;
  /** Just this page's slice, already mapped to summaries. */
  events: EventSummary[];
  /** Total events matching `filter`, before pagination. */
  matchedCount: number;
  /** The resolved, clamped, 1-based current page. Always a valid page for
   *  `totalPages` — see parseObservatoryPage's doc comment. */
  page: number;
  /** Always >= 1, even when matchedCount is 0 (a single, empty "page 1"). */
  totalPages: number;
  stats: ObservatoryStats;
  developerOptions: string[];
}

function toSummary(event: Event): EventSummary {
  return {
    slug: event.slug,
    title: event.title,
    occurredOn: event.occurredOn,
    developerOrOperator: event.developerOrOperator,
    systemName: event.systemName,
    eventType: event.eventType,
    valence: event.valence,
    reviewStatus: event.reviewStatus,
    origin: event.origin,
    sourceCount: event.sources.length,
  };
}

function byDateDescThenTitle(a: Event, b: Event): number {
  const dateDiff = partialDateSortKey(b.occurredOn).localeCompare(
    partialDateSortKey(a.occurredOn),
  );
  return dateDiff !== 0 ? dateDiff : a.title.localeCompare(b.title);
}

// --- pure helpers over an already-loaded event array ----------------------
// Split out so a caller that needs more than one of these (see
// getEventsPageData below) pays for exactly one loadEvents() call, not one
// per derived value. loadEvents() paginates 3 Supabase round trips for the
// full ~2,900-event corpus; calling it two or three times per page request
// measurably multiplied Observatory's load time, which is why this exists
// rather than three independent exported functions each doing their own
// `await loadEvents()`.

function filterEvents(events: readonly Event[], filter: EventListFilter): Event[] {
  return events
    .filter((event) => !filter.eventType || event.eventType === filter.eventType)
    .filter((event) => !filter.valence || event.valence === filter.valence)
    .filter(
      (event) =>
        !filter.developerOrOperator ||
        canonicalDeveloperLabel(event.developerOrOperator) === filter.developerOrOperator,
    );
}

function deriveDeveloperOptions(events: readonly Event[]): string[] {
  const distinct = new Set(
    events
      .map((event) => event.developerOrOperator)
      .filter((raw) => !EXCLUDED_DEVELOPER_RAW_VALUES.has(raw))
      .map(canonicalDeveloperLabel),
  );
  return [...distinct].sort((a, b) => a.localeCompare(b));
}

/**
 * Parses the Observatory-only `page` URL param. Not part of
 * SharedEventFilter/filter-params.ts on purpose — Map never has a notion of
 * "page" and must never see or preserve this parameter (see ViewSwitch,
 * which is built from the shared filter's own query string, not this).
 * Missing, zero, negative, non-integer, or non-numeric all fall back to 1;
 * clamping against the actual page count (once known) happens in
 * getEventsPageData, which is also what turns "beyond the final page" into
 * a safe, deterministic result rather than an empty page.
 */
function parseRequestedPage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = value ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function deriveObservatoryStats(events: readonly Event[]): ObservatoryStats {
  const byValence: Record<Valence, number> = {
    "failure-or-challenging": 0,
    "successful-handling": 0,
    "neutral-or-unclear": 0,
  };
  for (const event of events) {
    byValence[event.valence] += 1;
  }
  return { total: events.length, byValence };
}

/**
 * Everything the Observatory list page needs, from exactly one
 * `loadEvents()` call: the parsed filter (developerOrOperator validated/
 * backward-compat-resolved against the SAME loaded corpus's canonical
 * option list — see filter-params.ts), one page (OBSERVATORY_PAGE_SIZE
 * events) of the filtered+sorted summaries, the unfiltered stats, and the
 * full canonical developer/operator option list.
 *
 * Filtering happens first, then pagination, against the same in-memory
 * array — the full ~2,900-event corpus comfortably fits this for Beta; the
 * problem this solves is rendering thousands of EventCards into one HTML
 * response, not the filtering itself. A `page` beyond the last valid page
 * (including when a filter now matches fewer events than before) clamps
 * down to the final page rather than rendering an empty list.
 */
export async function getEventsPageData(searchParams: RawSearchParams): Promise<EventsPageData> {
  const allEvents = await loadEvents();
  const developerOptions = deriveDeveloperOptions(allEvents);
  const filter = parseSharedFilterParams(searchParams, developerOptions);
  const matched = filterEvents(allEvents, filter).sort(byDateDescThenTitle);
  const matchedCount = matched.length;
  const totalPages = Math.max(1, Math.ceil(matchedCount / OBSERVATORY_PAGE_SIZE));
  const page = Math.min(parseRequestedPage(searchParams.page), totalPages);
  const startIndex = (page - 1) * OBSERVATORY_PAGE_SIZE;
  const events = matched.slice(startIndex, startIndex + OBSERVATORY_PAGE_SIZE).map(toSummary);
  const stats = deriveObservatoryStats(allEvents);
  return { filter, events, matchedCount, page, totalPages, stats, developerOptions };
}

export async function listEventSummaries(
  filter: EventListFilter = {},
): Promise<EventSummary[]> {
  const events = await loadEvents();
  return filterEvents(events, filter).sort(byDateDescThenTitle).map(toSummary);
}

export async function getEventBySlug(slug: string): Promise<Event | null> {
  const events = await loadEvents();
  return events.find((event) => event.slug === slug) ?? null;
}

export async function listEventSlugs(): Promise<string[]> {
  const events = await loadEvents();
  return events.map((event) => event.slug);
}

/**
 * The full, unfiltered set of CANONICAL `developerOrOperator` options across
 * every public event — the Beta option list for the third shared filter
 * (Observatory + Map). Each event's raw string is mapped through the
 * explicit, audited grouping in ./developer-operator.ts (e.g. "Waymo",
 * "Waymo LLC", "WAYMO LLC" all collapse to one "Waymo" option); a raw value
 * on the exclusion list (currently just "Internal employee" — not an
 * organization) never becomes an option at all, though its event is
 * untouched and still appears in unfiltered browsing. Always derived from
 * the FULL corpus, independent of any currently-applied filter, so
 * selecting one filter never removes options from another.
 *
 * Map's page uses this directly (it needs only the option list, not events
 * or stats). Observatory's page uses getEventsPageData instead, which needs
 * all three and gets them from a single loadEvents() call.
 */
export async function listDeveloperOrOperatorOptions(): Promise<string[]> {
  const events = await loadEvents();
  return deriveDeveloperOptions(events);
}

export async function getObservatoryStats(): Promise<ObservatoryStats> {
  const events = await loadEvents();
  return deriveObservatoryStats(events);
}

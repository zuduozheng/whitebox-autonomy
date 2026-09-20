/**
 * Local, in-repository event source.
 *
 * This is the ONLY module that knows the events currently come from a
 * hand-authored file. A future Supabase-backed source implements the same
 * `loadEvents()` contract (returning `Event[]`), and `repository.ts` swaps this
 * import for that one — no route, page, or component changes.
 */

import { seedEvents } from "./data/seed";
import type { Event } from "./types";

/** Fail fast on malformed seed data during development and at build time. */
function assertInvariants(events: Event[]): void {
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.slug)) {
      throw new Error(`Duplicate event slug: "${event.slug}"`);
    }
    seen.add(event.slug);

    if (event.observedFacts.length === 0) {
      throw new Error(`Event "${event.slug}" has no observedFacts`);
    }
    // unknowns is deliberately NOT checked here: an empty array is a
    // legitimate value — a well-evidenced event can have nothing left
    // unestablished. See 20260904000000_unknowns_optional_for_publication.sql.
    if (event.sources.length === 0) {
      throw new Error(`Event "${event.slug}" has no sources`);
    }
    if (!event.recordUpdated) {
      throw new Error(`Event "${event.slug}" has no recordUpdated date`);
    }
  }
}

export async function loadEvents(): Promise<Event[]> {
  assertInvariants(seedEvents);
  return seedEvents;
}

/**
 * Narrow counterparts of ./supabase-source.ts's fetchEventBySlug(),
 * fetchEventSlugs(), and fetchDeveloperOrOperatorRawValues() — required so
 * repository.ts stays agnostic to which source is active (see this file's
 * header comment). The in-memory seed has no per-field query cost to save,
 * so these simply derive the same narrow result from the same validated
 * array loadEvents() already returns.
 */
export async function fetchEventBySlug(slug: string): Promise<Event | null> {
  assertInvariants(seedEvents);
  return seedEvents.find((event) => event.slug === slug) ?? null;
}

export async function fetchEventSlugs(): Promise<string[]> {
  assertInvariants(seedEvents);
  return seedEvents.map((event) => event.slug);
}

export async function fetchDeveloperOrOperatorRawValues(): Promise<string[]> {
  assertInvariants(seedEvents);
  return seedEvents.map((event) => event.developerOrOperator);
}

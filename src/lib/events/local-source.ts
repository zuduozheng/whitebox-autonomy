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

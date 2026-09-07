/**
 * Date formatting and sorting helpers for the event model. Pure functions, no
 * locale dependencies beyond a fixed English month table, so list output is
 * deterministic across environments.
 */

import type { PartialDate } from "./types";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Render a partial date at its stated precision. */
export function formatPartialDate(date: PartialDate): string {
  if (date.precision === "unknown" || !date.value) return "Date unknown";
  const [year, month, day] = date.value.split("-");
  if (date.precision === "year") return year;
  const monthName = MONTHS[Number(month) - 1] ?? month;
  if (date.precision === "month") return `${monthName} ${year}`;
  return `${Number(day)} ${monthName} ${year}`;
}

/** Render a full ISO date (YYYY-MM-DD), e.g. for `recordUpdated`. */
export function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  const monthName = MONTHS[Number(month) - 1] ?? month;
  return `${Number(day)} ${monthName} ${year}`;
}

/**
 * A comparable key for sorting. Coarser precisions are pinned to the start of
 * their period; "unknown" sorts last in a descending (newest-first) sort.
 */
export function partialDateSortKey(date: PartialDate): string {
  switch (date.precision) {
    case "day":
      return date.value;
    case "month":
      return `${date.value}-01`;
    case "year":
      return `${date.value}-01-01`;
    default:
      return "";
  }
}

/**
 * Compact pagination window — Observatory-only presentation logic (pure, no
 * React/DOM), split out so it can be unit-tested directly.
 *
 * Always includes page 1 and the last page, plus up to one sibling on each
 * side of the current page, collapsing any gap into a single "ellipsis"
 * marker — e.g. current=5, total=20 -> [1, "ellipsis", 4, 5, 6, "ellipsis",
 * 20]. Deliberately never renders more than a handful of page numbers
 * regardless of how large `totalPages` gets.
 */
export type PageWindowItem = number | "ellipsis";

export function computePageWindow(currentPage: number, totalPages: number): PageWindowItem[] {
  if (totalPages <= 1) return [1];

  const siblingCount = 1;
  const pages = new Set<number>([1, totalPages]);
  for (let p = currentPage - siblingCount; p <= currentPage + siblingCount; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const result: PageWindowItem[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("ellipsis");
    result.push(sorted[i]);
  }
  return result;
}

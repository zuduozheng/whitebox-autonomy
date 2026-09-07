/**
 * Developer/operator alias resolution — deliberately small, per the approved
 * rulebook policy: "only normalize variants whose equivalence is
 * unambiguous... Do NOT automatically collapse potentially meaningful
 * legal/entity variants such as 'Motional AD Inc.' -> 'Motional' unless
 * explicitly approved."
 *
 * The rule implemented here is narrow and provably safe: two strings are
 * treated as the same entity ONLY if they consist of the exact same words,
 * differing solely in punctuation (periods, commas) or hyphen-vs-space
 * spacing. It never adds or removes a word (no corporate-suffix stripping),
 * so it cannot collapse "Motional AD Inc." into "Motional" (different word
 * counts) but does correctly collapse "Waymo LLC." into "Waymo LLC" and
 * "Kodiak-Robotics, Inc." into "Kodiak Robotics, Inc" (same words, only
 * punctuation/spacing differs).
 *
 * This is a DERIVED-tier transformation (deterministic, no judgment) — see
 * docs/nhtsa-normalization-rulebook.md.
 */

/** Fold a name to a comparison key: lowercase, hyphens -> spaces, replace
 * periods/commas WITH a space (not delete outright), collapse whitespace.
 * Two names sharing a fold key contain the identical sequence of words.
 *
 * FIXED (targeted adversarial stress test, case 58ed5a4d4e93504): stripping
 * punctuation to "" rather than " " meant a comma with no following space
 * ("Kodiak Robotics,Inc.") folded to a DIFFERENT key than the same words
 * with a space after the comma ("Kodiak Robotics, Inc") — "roboticsinc" vs
 * "robotics inc" — leaving a purely cosmetic variant unresolved. Replacing
 * with a space before collapsing whitespace makes the fold agnostic to
 * whether a space happened to follow the punctuation mark, which is the
 * only thing that differed between those two values. */
function foldKey(name) {
  return name
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefer the shortest variant (fewest punctuation marks) as the canonical
 * display form when multiple variants share a fold key. */
function pickCanonical(variants) {
  return [...variants].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

/**
 * Resolve a candidate's developer_or_operator when the mechanical importer
 * left it null due to a disagreement among contributing reports.
 *
 * `reportValues` — the distinct non-null developer_or_operator values from
 * the candidate's contributing reports (already known to disagree, since the
 * candidate field is null).
 *
 * Returns { resolved: false } if the candidate already has a value (nothing
 * to do), or if the distinct values do not all share a fold key (a genuine,
 * possibly-substantive difference that must stay unresolved for curator
 * review). Returns { resolved: true, canonical, reason } only when every
 * distinct value folds to the same key.
 */
export function resolveDeveloperAlias(candidateValue, reportValues = []) {
  if (candidateValue !== null && candidateValue !== undefined) {
    return { resolved: false, reason: "candidate already has a consolidated value" };
  }
  const distinct = [...new Set(reportValues)];
  if (distinct.length < 2) {
    return { resolved: false, reason: "fewer than two distinct values to compare" };
  }
  const keys = new Set(distinct.map(foldKey));
  if (keys.size !== 1) {
    return {
      resolved: false,
      reason: "values differ by more than punctuation/spacing — potential genuine entity difference, left for curator review",
    };
  }
  return {
    resolved: true,
    canonical: pickCanonical(distinct),
    reason: `cosmetic punctuation/spacing variant of the same words (${distinct.join(" / ")})`,
  };
}

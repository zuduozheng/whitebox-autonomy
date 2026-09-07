/**
 * Field-agnostic cosmetic/approved-variant disagreement resolution —
 * implements the general "Source disagreements" policy from Normalization
 * Rulebook v1: only case, punctuation, and whitespace differences (or an
 * explicitly pre-approved canonical mapping) may be deterministically
 * auto-resolved. Anything else — including a plain spelling/edit-distance
 * difference with no approved mapping — is left unresolved for curator/AI
 * review.
 *
 * REVISED POLICY (superseding an earlier edit-distance heuristic): edit
 * distance alone is NOT sufficient evidence of which spelling is correct —
 * a typo can add a character as easily as omit one, so "prefer the longer
 * string" (the earlier approach) is not generally safe. Spelling
 * differences are now resolved ONLY via an explicit, reviewed entry in
 * APPROVED_SPELLING_MAPPINGS below — never algorithmically.
 *
 * This is distinct from alias-table.mjs (the small, deliberately
 * conservative developer/operator table, which never treats a dropped/added
 * word as cosmetic); this module handles free-text fields like `city`.
 */

/** Explicitly approved canonical mappings for known spelling variants that
 * are NOT safely resolvable by case/punctuation/whitespace folding alone.
 * Each entry is a deliberate, reviewed decision — this table must never be
 * populated algorithmically (e.g. by computing edit distance and picking a
 * "likely" winner). Keyed by the lowercased, trimmed non-canonical variant. */
const APPROVED_SPELLING_MAPPINGS = {
  // Approved: NHTSA filing typo confirmed against the sibling report in the
  // same disagreement (calibration case a3723c22-fe0b-49aa-a9fe-b1e3d782a761).
  "san fancisco": "San Francisco",
};

/** Fold to a comparison key using ONLY safe, information-preserving
 * transformations: lowercase, strip periods/commas, collapse whitespace.
 * Two values sharing a fold key differ by case/punctuation/whitespace only —
 * never by an added, removed, or substituted letter. */
function foldPunctuationAndCase(value) {
  return value
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** For a safe fold match, variants carry equal information — the
 * shorter/cleaner-looking one is a fine, arbitrary but safe choice. */
function pickCanonicalForSafeMatch(variants) {
  return [...variants].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

/**
 * `values` — the distinct non-null values from contributing reports for a
 * field the mechanical importer left null due to disagreement.
 *
 * Returns { resolved: true, canonical, reason } only when:
 *   (a) the values differ solely by case/punctuation/whitespace, or
 *   (b) one value is a key in APPROVED_SPELLING_MAPPINGS whose mapped
 *       canonical matches the other value.
 * Otherwise returns { resolved: false }, including for any plain spelling
 * difference with no approved mapping — that case is never guessed at.
 */
export function resolveCosmeticOrApprovedVariant(values = []) {
  const distinct = [...new Set(values)];
  if (distinct.length < 2) {
    return { resolved: false, reason: "fewer than two distinct values to compare" };
  }
  if (distinct.length > 2) {
    // Three-way disagreements are conservatively left for curator review in
    // this pilot rather than pairwise-resolved.
    return { resolved: false, reason: "more than two distinct values — left for curator review" };
  }

  const [a, b] = distinct;

  // SAFE: case/punctuation/whitespace-only difference.
  if (foldPunctuationAndCase(a) === foldPunctuationAndCase(b)) {
    return {
      resolved: true,
      canonical: pickCanonicalForSafeMatch(distinct),
      reason: "case/punctuation/whitespace-only variant of the same value",
    };
  }

  // Explicitly approved canonical mapping only — never edit distance,
  // never "prefer the longer/shorter string."
  for (const value of distinct) {
    const canonical = APPROVED_SPELLING_MAPPINGS[value.toLowerCase().trim()];
    if (!canonical) continue;
    const otherValue = distinct.find((v) => v !== value);
    if (otherValue === canonical || foldPunctuationAndCase(otherValue) === foldPunctuationAndCase(canonical)) {
      return {
        resolved: true,
        canonical,
        reason: `explicitly approved canonical mapping ("${value}" -> "${canonical}")`,
      };
    }
  }

  return {
    resolved: false,
    reason: "spelling difference with no explicitly approved canonical mapping — preserved for curator/AI review, not auto-resolved",
  };
}

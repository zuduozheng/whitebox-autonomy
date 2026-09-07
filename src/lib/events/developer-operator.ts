/**
 * Explicit, auditable canonical grouping for the "Developer / operator"
 * filter (Observatory + Map).
 *
 * WHAT THIS IS: a Beta, application-layer, DISPLAY/FILTER-TIME mapping only.
 * It never touches the database: `event.developer_or_operator` keeps its
 * original, unmodified, source-attributed string forever — this module only
 * decides which raw strings are treated as the same organization when a
 * user picks one option from the dropdown.
 *
 * WHERE THIS CAME FROM: a manual audit of all 74 distinct
 * `developer_or_operator` values across the full public corpus (2,923
 * events, captured 2026-09-10 via full pagination — see the audit report).
 * Every one of those 74 raw values is assigned to exactly one group below,
 * or to EXCLUDED_DEVELOPER_RAW_VALUES — this was verified programmatically
 * (1:1 coverage, no duplicates, no typos) against the live distinct-value
 * list before this file was written; see
 * migration/developer-operator/build-and-validate-groups.mjs for the
 * reproducible check.
 *
 * RULES ENCODED HERE (approved decisions, not automated inference):
 *   - A group's `rawValues` are exact strings only — no fuzzy/substring/
 *     edit-distance matching, ever, at runtime or otherwise. A future new
 *     raw value that isn't listed here is never guessed into an existing
 *     group; canonicalDeveloperLabel() falls back to using it as its own
 *     canonical label (identity), so it simply appears as its own new
 *     option — safe, never silently merged.
 *   - "Zoox and Waymo" (one curated event naming two companies jointly) is
 *     its OWN canonical option — never folded into either "Zoox" or
 *     "Waymo", which would misattribute the other company's involvement.
 *   - Corporate-affiliation relationships are never inferred from the
 *     strings alone: Hyundai Motor America / Kia America stay separate
 *     (shared parent group, but distinct legal filers), and Stack AV /
 *     Argo AI stay separate (historically connected via former staff, but
 *     legally distinct companies).
 *   - Canonical display labels drop redundant legal suffixes (Inc./LLC/
 *     Corp./SRL) and, conservatively, other purely redundant qualifiers
 *     (e.g. "Lucid USA, Inc." -> "Lucid") — but never a substantive
 *     descriptive word (e.g. "Apollo Autonomous Driving USA" and "Hyundai
 *     Motor America" are kept in full: neither has a plain trailing legal
 *     suffix, and shortening either further would risk losing real
 *     identifying information for a conservative Beta pass).
 */

export interface DeveloperOperatorGroup {
  /** The stable canonical value: used as the dropdown option's value, the
   *  `developerOrOperator` URL parameter's value, and the public display
   *  label — all three are deliberately the same string for Beta (see
   *  filter-params.ts's doc comment on keeping the URL model simple). */
  canonical: string;
  /** Every raw `event.developer_or_operator` string that maps to this
   *  canonical operator. Exact match only. */
  rawValues: readonly string[];
}

export const DEVELOPER_OPERATOR_GROUPS: readonly DeveloperOperatorGroup[] = [
  {
    canonical: "Waymo",
    rawValues: ["Waymo", "Waymo LLC", "WAYMO LLC", "Waymo LLc", "Waymo LLlC"],
  },
  {
    canonical: "Tesla",
    rawValues: ["Tesla", "Tesla Inc"],
  },
  {
    canonical: "Cruise",
    rawValues: ["Cruise", "CRUISE", "Cruise LLC"],
  },
  {
    canonical: "Zoox",
    rawValues: ["Zoox", "Zoox Inc.", "Zoox, Inc"],
  },
  {
    canonical: "Avride",
    rawValues: ["Avride", "Avride Inc", "Avride INC", "Avride Inc.", "Avride INC."],
  },
  {
    canonical: "Aurora",
    rawValues: ["Aurora Operations, Inc", "Aurora Operations, Inc."],
  },
  {
    canonical: "May Mobility",
    rawValues: ["May Mobility", "May Mobility Inc", "May Mobility Inc."],
  },
  {
    canonical: "Nuro",
    rawValues: ["Nuro", "Nuro Inc", "Nuro Inc.", "Nuro, Inc."],
  },
  {
    canonical: "Beep",
    rawValues: ["Beep", "BEEP Inc", "Beep Inc.", "Beep, Inc", "Beep, Inc."],
  },
  {
    canonical: "Kodiak Robotics",
    rawValues: ["Kodiak Robotics, Inc", "Kodiak Robotics, Inc."],
  },
  {
    canonical: "Pony.ai",
    rawValues: ["Pony.ai", "Pony.ai, Inc", "Pony.ai, Inc."],
  },
  {
    canonical: "PlusAI",
    rawValues: ["PLUSAI, INC", "PlusAI, Inc."],
  },
  {
    canonical: "Torc Robotics",
    rawValues: ["Torc Robotics, Inc", "TORC ROBOTICS, INC"],
  },
  {
    canonical: "WeRide",
    rawValues: ["WeRide", "Weride Corp", "WeRide Corp"],
  },
  {
    // "VWGoA- ADMT" (reversed word order) approved for merge on review —
    // same two name components as the other two, just reordered.
    canonical: "ADMT / VWGoA",
    rawValues: ["ADMT - VWGoA", "ADMT- VWGoA", "VWGoA- ADMT"],
  },
  {
    // Approved on review: "RD NA" / "Research and Development NA" /
    // "...North America" are an abbreviation relationship, not a spelling
    // one, but confirmed to be the same reporting entity.
    canonical: "Mercedes-Benz R&D North America",
    rawValues: [
      "Mercedes-Benz RD NA",
      "Mercedes-Benz Research and Development NA",
      "Mercedes-Benz Research and Development North America",
    ],
  },
  // --- Singleton canonical operators (no raw variant to merge) ---
  // Display label applies the "drop the legal suffix" convention where the
  // raw string is a plain "Brand + Inc./LLC/Corp./SRL"-shaped name; left in
  // full where the trailing text is a substantive descriptor rather than a
  // legal suffix (Apollo Autonomous Driving USA, Hyundai Motor America,
  // Colorado School of Mines, Robotic Research).
  { canonical: "Apollo Autonomous Driving USA", rawValues: ["Apollo Autonomous Driving USA"] },
  { canonical: "Apple", rawValues: ["Apple Inc."] },
  { canonical: "Argo AI", rawValues: ["Argo AI"] },
  { canonical: "AutoX Technologies", rawValues: ["AutoX Technologies, Inc."] },
  { canonical: "Chrysler", rawValues: ["Chrysler (FCA US, LLC)"] },
  { canonical: "Colorado School of Mines", rawValues: ["Colorado School of Mines"] },
  { canonical: "First Transit", rawValues: ["First Transit, Inc."] },
  { canonical: "Gatik AI", rawValues: ["Gatik AI Inc."] },
  { canonical: "Ghost Autonomy", rawValues: ["Ghost Autonomy Inc."] },
  { canonical: "Hyundai Motor America", rawValues: ["Hyundai Motor America"] },
  { canonical: "Kia America", rawValues: ["Kia America, Inc."] },
  { canonical: "Lucid", rawValues: ["Lucid USA, Inc."] },
  { canonical: "Motional", rawValues: ["Motional"] },
  { canonical: "Navistar", rawValues: ["Navistar, Inc."] },
  { canonical: "NAVYA", rawValues: ["NAVYA Inc."] },
  { canonical: "Ohmio", rawValues: ["Ohmio"] },
  { canonical: "Polestar", rawValues: ["Polestar"] },
  { canonical: "Robotic Research", rawValues: ["Robotic Research"] },
  { canonical: "Stack AV", rawValues: ["Stack AV Co."] },
  { canonical: "TuSimple", rawValues: ["TuSimple"] },
  { canonical: "VinFast", rawValues: ["VinFast Auto, LLC"] },
  { canonical: "VisLab", rawValues: ["VisLab, SRL (subsidiary of Ambarella, Inc.)"] },
  // Deliberately its own canonical option — see the file-level doc comment.
  { canonical: "Zoox and Waymo", rawValues: ["Zoox and Waymo"] },
];

/**
 * Raw values excluded from the Developer/operator dropdown entirely — not
 * merged anywhere, not given a canonical label, simply never offered as a
 * filter option. The underlying events are completely untouched and still
 * appear normally in unfiltered browsing.
 */
export const EXCLUDED_DEVELOPER_RAW_VALUES: ReadonlySet<string> = new Set([
  // Not an organization name — an NHTSA-side anonymization placeholder.
  "Internal employee",
]);

const CANONICAL_BY_RAW: ReadonlyMap<string, string> = new Map(
  DEVELOPER_OPERATOR_GROUPS.flatMap((group) => group.rawValues.map((raw) => [raw, group.canonical] as const)),
);

const RAW_VALUES_BY_CANONICAL: ReadonlyMap<string, readonly string[]> = new Map(
  DEVELOPER_OPERATOR_GROUPS.map((group) => [group.canonical, group.rawValues] as const),
);

/**
 * Maps one event's raw `developer_or_operator` to its canonical display
 * label. A raw value with no explicit entry above (a future new filer not
 * yet audited) maps to itself — never guessed into an existing group.
 */
export function canonicalDeveloperLabel(raw: string): string {
  return CANONICAL_BY_RAW.get(raw) ?? raw;
}

/**
 * The exact raw values a canonical filter selection must match. Used by the
 * bounded map query layer (which talks to Postgres directly and must
 * express "canonical = X" as "raw IN (...)", since the database itself
 * knows nothing about canonical grouping). A canonical value with no known
 * group (defensive fallback — should not occur for a value that came from
 * this module's own option list) matches only its own literal string.
 */
export function rawValuesForCanonicalDeveloper(canonical: string): readonly string[] {
  return RAW_VALUES_BY_CANONICAL.get(canonical) ?? [canonical];
}

/**
 * Backward-compatible resolution for a `developerOrOperator` URL param:
 * accepts either a current canonical value or any raw value that used to be
 * (and, on the underlying data, still is) a valid filter value before this
 * grouping existed — e.g. an old shared link with `?developerOrOperator=
 * Waymo%20LLC` still resolves to the "Waymo" canonical filter rather than
 * silently dropping the filter. Returns undefined for anything else
 * (unknown/garbage value), same as before this feature existed.
 */
export function resolveCanonicalDeveloperParam(
  value: string,
  canonicalOptions: readonly string[],
): string | undefined {
  if (canonicalOptions.includes(value)) return value;
  const canonical = CANONICAL_BY_RAW.get(value);
  return canonical && canonicalOptions.includes(canonical) ? canonical : undefined;
}

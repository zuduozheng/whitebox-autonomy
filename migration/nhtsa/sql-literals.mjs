/**
 * SQL literal helpers, generalizing migration/legacy/build-import.mjs's
 * `sql()` to the extra types the NHTSA artifact needs (jsonb, integer,
 * text[]). Every literal is either NULL or a single-quoted, quote-doubled
 * string with an explicit cast — no string concatenation ever mixes
 * unescaped user data into SQL structure.
 */

/** Standard SQL string literal (single quotes doubled). null/undefined -> null. */
export function sqlText(v) {
  if (v === null || v === undefined) return "null";
  const s = String(v);
  if (s.includes("\0")) throw new Error(`NUL byte in value: ${JSON.stringify(s)}`);
  return `'${s.replace(/'/g, "''")}'`;
}

/** SQL integer literal. null/undefined -> null. Throws on a non-integer. */
export function sqlInt(v) {
  if (v === null || v === undefined) return "null";
  if (!Number.isInteger(v)) throw new Error(`sqlInt: not an integer: ${JSON.stringify(v)}`);
  return String(v);
}

/** SQL date literal (expects 'YYYY-MM-DD' or null). */
export function sqlDate(v) {
  if (v === null || v === undefined) return "null";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`sqlDate: not YYYY-MM-DD: ${JSON.stringify(v)}`);
  return `${sqlText(v)}::date`;
}

/** SQL jsonb literal from a plain JS value (object/array/etc). Never null here. */
export function sqlJsonb(value) {
  const json = JSON.stringify(value);
  if (json.includes("\0")) throw new Error("NUL byte in jsonb payload");
  return `${sqlText(json)}::jsonb`;
}

/** SQL text[] literal. Empty array -> array[]::text[]. Never contains null elements here. */
export function sqlTextArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "array[]::text[]";
  return `array[${arr.map(sqlText).join(", ")}]`;
}

/** SQL uuid literal or null. */
export function sqlUuid(v) {
  if (v === null || v === undefined) return "null";
  return `${sqlText(v)}::uuid`;
}

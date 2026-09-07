/**
 * Minimal RFC 4180 CSV parser — no dependencies, matching this repo's existing
 * migration/legacy/ convention of zero-dependency one-off scripts.
 *
 * Handles what NHTSA's SGO export actually uses: comma-separated fields,
 * double-quote quoting, doubled-quote ("") as an escaped literal quote, and
 * quoted fields containing embedded commas and embedded newlines (both CRLF
 * and bare LF — the historical file's Narrative column contains both, mixed
 * with genuine row-ending CRLFs). Every row is returned with exactly
 * `header.length` fields; a short row is padded with "", a long row throws
 * (surfacing a malformed source row instead of silently misaligning columns).
 */

/** Parse full CSV text into { header: string[], rows: string[][] }. */
export function parseCsv(text) {
  // Strip a UTF-8 BOM if present (NHTSA exports carry one).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  const len = text.length;
  let i = 0;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // Treat CRLF and a lone CR both as one record break.
      if (text[i + 1] === "\n") i += 1;
      endRecord();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRecord();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Final record if the file doesn't end with a newline.
  if (field.length > 0 || record.length > 0) {
    endRecord();
  }

  // Drop trailing fully-blank records (trailing newline artifacts).
  while (records.length > 0) {
    const last = records[records.length - 1];
    if (last.length === 1 && last[0] === "") records.pop();
    else break;
  }

  if (records.length === 0) return { header: [], rows: [] };

  const header = records[0];
  const rows = records.slice(1).map((r, idx) => {
    if (r.length === header.length) return r;
    if (r.length < header.length) {
      return [...r, ...Array(header.length - r.length).fill("")];
    }
    throw new Error(
      `CSV row ${idx + 2} has ${r.length} fields, expected ${header.length} (malformed quoting?)`,
    );
  });

  return { header, rows };
}

/** Zip a parsed row into a { "Column Name": value } object keyed by header. */
export function rowToRecord(header, row) {
  const rec = {};
  for (let i = 0; i < header.length; i++) rec[header[i]] = row[i];
  return rec;
}

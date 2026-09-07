/**
 * Canonical verification projection + expected hash for the publication
 * batch — same methodology as ../build-verification-projection.mjs (the
 * private-promotion one): project every record down to ONLY the fields this
 * operation actually changes or must NOT change, excluding every DB-owned
 * column (id itself is kept as `eventId` since it's a stable join key here,
 * not a DB-generated surprise; created_at/updated_at/first_published_at are
 * excluded — first_published_at in particular is a genuinely non-
 * deterministic runtime value, stamped at whatever instant the real COMMIT
 * happens, so it can never be part of a pre-computed expected hash), sort
 * deterministically by slug, then hash.
 *
 * This script builds the projection from the LOCAL production export plus
 * the generator's own eligibility/title logic — i.e. the EXPECTED state
 * after a correct publication. The equivalent projection built from
 * production AFTER a real apply (not built or run by this script) must
 * reproduce the identical hash.
 *
 * Run: node migration/nhtsa/wba-events/publish/build-verification-projection.mjs
 * Writes: publish-verification-projection.json, prints the expected hash.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import {
  loadProductionExport,
  evaluateAllRecords,
  partitionEligibility,
  buildTitledEligibleSet,
} from "./build-publication-sql.mjs";

const DIR = fileURLToPath(new URL("./", import.meta.url));
const PROJECTION_PATH = DIR + "publish-verification-projection.json";

/**
 * The exact, ordered field set this projection carries — matches the
 * canonical-verification design's own minimum list: linked candidate
 * identity, event id, slug, origin, generated title, is_public, summary,
 * review_status, observed_facts, developer_or_operator, event_type,
 * valence, source count.
 */
export function projectRecord({ record, title }) {
  const event = record.event;
  return {
    candidateId: record.candidateId,
    eventId: record.linkedEventId,
    slug: event.slug,
    origin: event.origin,
    title,
    is_public: true,
    summary: event.summary,
    review_status: event.review_status,
    observed_facts: event.observed_facts,
    developer_or_operator: event.developer_or_operator,
    event_type: event.event_type,
    valence: event.valence,
    sourceCount: record.sources.length,
  };
}

export function buildVerificationProjection(titled) {
  return titled.map(projectRecord).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

export function serializeProjection(projection) {
  return JSON.stringify(projection);
}

export function hashProjection(projection) {
  return createHash("sha256").update(serializeProjection(projection)).digest("hex");
}

function main() {
  const records = loadProductionExport();
  const evaluated = evaluateAllRecords(records);
  const { eligible } = partitionEligibility(evaluated);
  const titled = buildTitledEligibleSet(eligible);

  const projection = buildVerificationProjection(titled);
  const serialized = serializeProjection(projection);
  const hash = hashProjection(projection);

  writeFileSync(
    PROJECTION_PATH,
    JSON.stringify(
      {
        recordCount: projection.length,
        totalSourceCount: projection.reduce((n, r) => n + r.sourceCount, 0),
        expectedSha256: hash,
        projectionByteLength: serialized.length,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`Projected ${projection.length} publishable records.`);
  console.log(`Expected publication verification SHA-256: ${hash}`);
  console.log(`Wrote ${PROJECTION_PATH}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

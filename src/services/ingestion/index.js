// Public entry point for the ingestion pipeline.
//
// Everything exported here is runtime-agnostic (Node 18+, browsers, serverless).
// Server-only pieces live outside this folder so the client bundle can import
// `describeSources` for the admin view without dragging in firebase-admin.

export { runSync } from './sync.js';
export { planSync, diffSyncedFields, externalKey, titleDateKey } from './dedupe.js';
export {
  normalizeIngestedEvent,
  CURATED_ORIGIN,
  CURATED_HOST_UID,
  SYNCED_FIELDS,
} from './normalize.js';
export { parseIcs } from './ics.js';
export { parseFeed } from './feedXml.js';
export { SOURCES, describeSources, getSource, getSources, SOURCE_IDS } from './sources/index.js';
export { AUSTIN_TIME_ZONE, parseDateValue, parseIcsDate, isoDay } from './time.js';
export { inferCategory, inferNeighborhood, inferTags } from './taxonomy.js';
export { stableHash, slugify, stripHtml, truncate } from './text.js';

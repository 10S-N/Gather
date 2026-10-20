// Registry of ingestion sources. Adding a source is a three-step pattern:
//   1. write `sources/<name>.js` exporting an adapter + metadata
//   2. import it here and add it to SOURCES
//   3. add its env vars to .env.example and the README table
//
// Adapter contract:
//   {
//     id, label, kind,             // identity + how it fetches
//     envVars: string[],           // everything it needs configured
//     docsUrl?,                    // where to get credentials
//     isConfigured(env) -> bool,
//     fetchEvents({ env, fetchImpl, now, timeZone }) -> Promise<rawEvent[]>
//   }
// Anything a source throws is caught per-source by the orchestrator, so one
// broken feed never blocks the others.

import { eventbriteSource } from './eventbrite.js';
import { fixtureSource } from './fixtures.js';
import { lumaSource } from './luma.js';
import { rssSource } from './rss.js';

export const SOURCES = [eventbriteSource, lumaSource, rssSource, fixtureSource];

export const SOURCE_IDS = SOURCES.map((source) => source.id);

export function getSource(id) {
  return SOURCES.find((source) => source.id === id) || null;
}

export function describeSources(env = {}) {
  return SOURCES.map((source) => ({
    id: source.id,
    label: source.label,
    kind: source.kind,
    envVars: source.envVars,
    docsUrl: source.docsUrl || '',
    configured: Boolean(source.isConfigured?.(env)),
  }));
}

// Returns the adapters we should actually run. `only` narrows by id (the CLI's
// --source flag), `exclude` removes ids the admin toggled off for this run, and
// unconfigured sources are dropped unless `includeUnconfigured` is set, which
// the admin view uses to explain what is missing.
export function getSources(env = {}, { only = [], exclude = [], includeUnconfigured = false } = {}) {
  const wanted = only.length ? new Set(only) : null;
  const blocked = new Set(exclude);
  return SOURCES.filter((source) => {
    if (blocked.has(source.id)) return false;
    if (wanted && !wanted.has(source.id)) return false;
    return includeUnconfigured || Boolean(source.isConfigured?.(env));
  });
}

export { eventbriteSource, fixtureSource, lumaSource, rssSource };

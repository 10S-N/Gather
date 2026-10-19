// The sync orchestrator. Framework-free on purpose: the CLI, the serverless
// handler, and the tests all call `runSync` with a different `store`. That keeps
// the expensive logic testable without Firestore or the network.
//
// Store contract:
//   loadExisting({ activeSourceIds, now }) -> Promise<existingRow[]>
//   commit({ creates, updates, expired, now }) -> Promise<{created, updated, expired, batches}>
//   recordRun(run) -> Promise<void>

import { planSync } from './dedupe.js';
import { normalizeIngestedEvent } from './normalize.js';
import { AUSTIN_TIME_ZONE } from './time.js';
import { describeSources } from './sources/index.js';

const DEFAULT_MAX_PER_SOURCE = 200;
const MAX_SKIP_SAMPLES = 25;

export async function runSync({
  sources = [],
  store,
  env = {},
  now = new Date(),
  fetchImpl,
  dryRun = false,
  pruneExpired = false,
  expireAfterDays = 7,
  maxPerSource = DEFAULT_MAX_PER_SOURCE,
  trigger = 'manual',
  timeZone = AUSTIN_TIME_ZONE,
  logger = console,
} = {}) {
  if (!store) throw new Error('runSync requires a store');
  const startedAt = new Date();
  const warnings = [];
  const sourceReports = [];
  const incoming = [];
  const activeSourceIds = [];
  const skipSamples = [];

  for (const source of sources) {
    const report = {
      id: source.id,
      label: source.label,
      kind: source.kind,
      configured: Boolean(source.isConfigured?.(env)),
      ok: false,
      fetched: 0,
      imported: 0,
      invalid: 0,
      error: '',
    };

    if (!report.configured) {
      report.error = `Not configured — set ${source.envVars.join(', ')}`;
      sourceReports.push(report);
      continue;
    }

    try {
      const raws = await source.fetchEvents({ env, fetchImpl, now, timeZone });
      report.fetched = raws.length;

      const capped = raws.slice(0, maxPerSource);
      if (raws.length > capped.length) {
        warnings.push(`${source.id}: capped at ${maxPerSource} events (saw ${raws.length})`);
      }

      for (const raw of capped) {
        const result = normalizeIngestedEvent(raw, source, { now, timeZone });
        if (!result.ok) {
          report.invalid += 1;
          if (skipSamples.length < MAX_SKIP_SAMPLES) {
            skipSamples.push({
              sourceId: source.id,
              title: result.title || '(untitled)',
              reason: result.reason,
            });
          }
          continue;
        }
        incoming.push(result.doc);
      }

      report.imported = capped.length - report.invalid;
      report.ok = true;
      activeSourceIds.push(source.id);
    } catch (err) {
      report.error = err?.message || String(err);
      logger?.warn?.(`[sync] ${source.id} failed: ${report.error}`);
    }

    sourceReports.push(report);
  }

  const existing = store.loadExisting
    ? await store.loadExisting({ activeSourceIds, now })
    : [];

  const plan = planSync({
    incoming,
    existing,
    now,
    timeZone,
    pruneExpired,
    expireAfterDays,
    activeSourceIds,
  });

  let committed = { created: 0, updated: 0, expired: 0, batches: 0 };
  if (!dryRun && (plan.creates.length || plan.updates.length || plan.expired.length)) {
    committed = await store.commit({ ...plan, now });
  }

  const finishedAt = new Date();
  const run = {
    trigger,
    dryRun,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    sources: sourceReports,
    totals: {
      fetched: sourceReports.reduce((sum, s) => sum + s.fetched, 0),
      imported: incoming.length,
      invalid: sourceReports.reduce((sum, s) => sum + s.invalid, 0),
      created: dryRun ? 0 : committed.created,
      updated: dryRun ? 0 : committed.updated,
      expired: dryRun ? 0 : committed.expired,
      unchanged: plan.unchanged.length,
      skipped: plan.skipped.length,
    },
    planned: {
      creates: plan.creates.length,
      updates: plan.updates.length,
      expired: plan.expired.length,
      unchanged: plan.unchanged.length,
      skipped: plan.skipped.length,
    },
    skipped: [...plan.skipped, ...skipSamples].slice(0, MAX_SKIP_SAMPLES),
    sampleCreates: plan.creates.slice(0, 5).map((item) => ({
      title: item.doc.title,
      neighborhood: item.doc.neighborhood,
      category: item.doc.category,
      startAt: item.doc.startAt.toISOString(),
      sourceUrl: item.doc.sourceUrl,
    })),
    warnings,
    sourcesConfigured: describeSources(env).map((source) => ({
      id: source.id,
      label: source.label,
      configured: source.configured,
    })),
  };

  if (!dryRun && typeof store.recordRun === 'function') {
    try {
      run.runId = await store.recordRun(run);
    } catch (err) {
      // Losing the audit entry must never fail a sync that already committed.
      warnings.push(`Could not record sync run: ${err?.message || err}`);
    }
  }

  return run;
}

// Deduplication + change detection. Pure: given the normalized events from this
// run and the rows already in Firestore, decide what to create, update, skip,
// or expire. The store only executes the plan.
//
// Matching rules, in order:
//   1. external id          (source + externalId) — the reliable key
//   2. normalized title + start date — catches the same event syndicated to
//      several calendars, or a feed that changes its ids between runs
// A community post always wins: we never overwrite or shadow something a
// neighbor posted by hand.

import { SYNCED_FIELDS } from './normalize.js';
import { isoDay, parseDateValue } from './time.js';
import { slugify } from './text.js';

export function externalKey(sourceId, externalId) {
  return `${sourceId}:${externalId}`;
}

// Bucketed by the local (Austin) calendar day so a 7:30pm show that lands on
// the next UTC day still matches the same event syndicated elsewhere.
export function titleDateKey(title, startAt, timeZone) {
  const day = isoDay(startAt, timeZone);
  if (!day) return '';
  return `${slugify(title)}@${day}`;
}

function comparable(field, value) {
  if (field === 'startAt' || field === 'endAt') {
    return parseDateValue(value)?.getTime() ?? 0;
  }
  if (field === 'tags') {
    return Array.isArray(value) ? value.join('|').toLowerCase() : '';
  }
  return value == null ? '' : String(value);
}

// Returns the subset of synced fields that actually differ, plus the patch to
// write. Avoids bumping `updatedAt` (and re-notifying every open tab) when a
// feed returns identical data.
export function diffSyncedFields(next, prev) {
  const patch = {};
  const changed = [];
  for (const field of SYNCED_FIELDS) {
    if (comparable(field, next[field]) !== comparable(field, prev?.[field])) {
      patch[field] = next[field];
      changed.push(field);
    }
  }
  return { patch, changed };
}

export function planSync({
  incoming = [],
  existing = [],
  now = new Date(),
  timeZone,
  pruneExpired = false,
  expireAfterDays = 7,
  activeSourceIds = [],
} = {}) {
  const byExternal = new Map();
  const byTitleDate = new Map();

  for (const row of existing) {
    if (row?.origin === 'curated' && row.externalId && row.source) {
      byExternal.set(externalKey(row.source, row.externalId), row);
    }
    const key = titleDateKey(row?.title || '', row?.startAt, timeZone);
    if (key && !byTitleDate.has(key)) byTitleDate.set(key, row);
  }

  const creates = [];
  const updates = [];
  const unchanged = [];
  const skipped = [];
  const touched = new Set();
  const seen = new Set();

  for (const doc of incoming) {
    const extKey = externalKey(doc.source, doc.externalId);
    if (seen.has(extKey)) {
      skipped.push({ reason: 'duplicate within this run', title: doc.title, sourceId: doc.source, externalId: doc.externalId });
      continue;
    }
    seen.add(extKey);

    const titleKey = titleDateKey(doc.title, doc.startAt, timeZone);
    const byId = byExternal.get(extKey);
    const match = byId || (titleKey ? byTitleDate.get(titleKey) : null);

    if (!match) {
      creates.push({ id: doc.id, doc });
      touched.add(doc.id);
      byExternal.set(extKey, doc);
      if (titleKey && !byTitleDate.has(titleKey)) byTitleDate.set(titleKey, doc);
      continue;
    }

    if (match.origin && match.origin !== 'curated') {
      skipped.push({
        reason: 'already posted by a neighbor',
        title: doc.title,
        sourceId: doc.source,
        externalId: doc.externalId,
      });
      continue;
    }

    // Same event, different calendar: keep the first curated copy we stored.
    if (!byId && match.source && match.source !== doc.source) {
      skipped.push({
        reason: `already curated from ${match.source}`,
        title: doc.title,
        sourceId: doc.source,
        externalId: doc.externalId,
      });
      continue;
    }

    const { patch, changed } = diffSyncedFields(doc, match);
    touched.add(match.id);
    if (!changed.length) {
      unchanged.push({ id: match.id, title: doc.title });
      continue;
    }
    updates.push({ id: match.id, patch, changed, doc });
  }

  const expired = [];
  if (pruneExpired) {
    const cutoff = now.getTime() - expireAfterDays * 86_400_000;
    const activeSources = new Set(activeSourceIds);
    for (const row of existing) {
      if (row?.origin !== 'curated') continue;
      if (activeSources.size && !activeSources.has(row.source)) continue;
      if (touched.has(row.id)) continue;
      const start = parseDateValue(row.startAt);
      if (!start || start.getTime() > cutoff) continue;
      expired.push({ id: row.id, title: row.title || 'Untitled event' });
    }
  }

  return {
    creates,
    updates,
    unchanged,
    skipped,
    expired,
    stats: {
      incoming: incoming.length,
      creates: creates.length,
      updates: updates.length,
      unchanged: unchanged.length,
      skipped: skipped.length,
      expired: expired.length,
    },
  };
}

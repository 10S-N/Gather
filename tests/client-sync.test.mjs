import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CATEGORIES } from '../src/data/neighborhoods.js';
import {
  documentFromPlan,
  rowFromSnapshot,
  toTimestamp,
} from '../src/services/ingestion/clientStore.js';
import {
  CURATED_HOST_UID,
  getSources,
  normalizeIngestedEvent,
  runSync,
} from '../src/services/ingestion/index.js';
import {
  buildFixtureEvents,
  fixtureSource,
} from '../src/services/ingestion/sources/fixtures.js';

// Pinned so the 120-day window and the generated dates never drift.
const NOW = new Date('2026-10-18T15:00:00Z');

function createMemoryStore(seed = []) {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  const store = {
    rows,
    commits: [],
    runs: [],
    async loadExisting() {
      return [...rows.values()].map((row) => ({ ...row }));
    },
    async commit({ creates, updates, expired }) {
      for (const { id, doc } of creates) rows.set(id, { ...doc });
      for (const { id, patch } of updates) rows.set(id, { ...rows.get(id), ...patch });
      for (const { id } of expired) rows.delete(id);
      store.commits.push({
        creates: creates.length,
        updates: updates.length,
        expired: expired.length,
      });
      return { created: creates.length, updated: updates.length, expired: expired.length, batches: 1 };
    },
    async recordRun(run) {
      store.runs.push(run);
      return `run-${store.runs.length}`;
    },
  };
  return store;
}

const FIXTURE_ENV = { SYNC_FIXTURES: '1' };

test('the demo fixture source is opt-in only', () => {
  assert.equal(fixtureSource.isConfigured({}), false);
  assert.equal(fixtureSource.isConfigured({ SYNC_FIXTURES: '' }), false);
  assert.equal(fixtureSource.isConfigured({ SYNC_FIXTURES: '0' }), false);
  assert.equal(fixtureSource.isConfigured(FIXTURE_ENV), true);
  assert.equal(fixtureSource.isConfigured({ SYNC_FIXTURES: true }), true);

  // The registry must not quietly include it in a real run.
  assert.deepEqual(
    getSources({}, { only: ['fixture'] }),
    [],
  );
  assert.deepEqual(
    getSources(FIXTURE_ENV, { only: ['fixture'] }).map((source) => source.id),
    ['fixture'],
  );
});

test('fixture events are upcoming, in Austin, and normalize into curated docs', () => {
  const raws = buildFixtureEvents(NOW);
  assert.equal(raws.length, 4);

  for (const raw of raws) {
    const result = normalizeIngestedEvent(raw, fixtureSource, { now: NOW });
    assert.equal(result.ok, true, `${raw.title}: ${result.reason}`);

    const doc = result.doc;
    assert.match(doc.id, /^fixture_[a-z0-9]+$/);
    assert.equal(doc.origin, 'curated');
    assert.equal(doc.hostUid, CURATED_HOST_UID);
    assert.equal(doc.source, 'fixture');
    assert.equal(doc.sourceLabel, 'Demo fixture');
    assert.equal(doc.externalId, raw.externalId);
    assert.ok(doc.startAt instanceof Date);
    assert.ok(doc.startAt.getTime() > NOW.getTime());
    assert.ok(doc.endAt > doc.startAt);
    assert.ok(CATEGORIES.includes(doc.category), `unexpected category ${doc.category}`);
    assert.ok(doc.neighborhood, 'every fixture should infer a neighborhood');
    assert.ok(doc.description.length >= 20);
    assert.equal(doc.attendeeCount, 0);
    assert.equal(doc.capacity, null);
  }

  // Stable ids across runs are what make a repeat sync a no-op.
  const again = buildFixtureEvents(new Date(NOW.getTime() + 3_600_000));
  assert.deepEqual(
    again.map((raw) => raw.externalId),
    raws.map((raw) => raw.externalId),
  );
});

test('a second fixture run writes nothing', async () => {
  const store = createMemoryStore();
  const first = await runSync({
    sources: [fixtureSource],
    store,
    env: FIXTURE_ENV,
    now: NOW,
    trigger: 'browser',
  });

  assert.equal(first.totals.fetched, 4);
  assert.equal(first.totals.created, 4);
  assert.equal(first.totals.updated, 0);
  assert.equal(store.rows.size, 4);
  assert.equal(store.runs.length, 1);
  assert.equal(store.runs[0].trigger, 'browser');

  const second = await runSync({
    sources: [fixtureSource],
    store,
    env: FIXTURE_ENV,
    now: NOW,
    trigger: 'browser',
  });

  assert.equal(second.totals.created, 0);
  assert.equal(second.totals.updated, 0);
  assert.equal(second.totals.unchanged, 4);
  assert.equal(store.rows.size, 4);
  // No second commit: nothing changed, so no writes were issued at all.
  assert.equal(store.commits.length, 1);
});

test('client store writes Timestamps and reads snapshots back as Dates', () => {
  const now = new Date('2026-10-18T15:00:00Z');
  const startAt = new Date('2026-10-20T01:00:00Z');

  const written = documentFromPlan(
    { id: 'fixture_abc', title: 'Zine swap', startAt, endAt: null, origin: 'curated' },
    now,
  );
  assert.equal(written.startAt.toDate().toISOString(), startAt.toISOString());
  assert.equal(written.endAt, null);
  assert.equal(written.syncedAt.toDate().toISOString(), now.toISOString());

  const row = rowFromSnapshot({
    id: 'fixture_abc',
    data: () => ({ title: 'Zine swap', startAt: toTimestamp(startAt), endAt: null }),
  });
  assert.ok(row.startAt instanceof Date);
  assert.equal(row.startAt.toISOString(), startAt.toISOString());
  assert.equal(row.endAt, null);
  assert.equal(row.id, 'fixture_abc');
});

test('a fixture never shadows a neighbor post for the same event', async () => {
  const [raw] = buildFixtureEvents(NOW);
  const { doc } = normalizeIngestedEvent(raw, fixtureSource, { now: NOW });

  const store = createMemoryStore([
    {
      id: 'community-1',
      origin: 'community',
      source: 'community',
      title: doc.title,
      startAt: doc.startAt,
      endAt: doc.endAt,
      hostUid: 'neighbor-uid',
    },
  ]);

  const run = await runSync({
    sources: [fixtureSource],
    store,
    env: FIXTURE_ENV,
    now: NOW,
    trigger: 'browser',
  });

  assert.equal(run.totals.created, 3);
  assert.equal(run.totals.skipped, 1);
  assert.equal(
    run.skipped.some((item) => item.reason === 'already posted by a neighbor'),
    true,
  );
  assert.equal(store.rows.get('community-1').hostUid, 'neighbor-uid');
  assert.equal(store.rows.get('community-1').origin, 'community');
});

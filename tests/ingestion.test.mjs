import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planSync, diffSyncedFields, titleDateKey } from '../src/services/ingestion/dedupe.js';
import { parseFeed } from '../src/services/ingestion/feedXml.js';
import { parseIcs } from '../src/services/ingestion/ics.js';
import { normalizeIngestedEvent, CURATED_HOST_UID } from '../src/services/ingestion/normalize.js';
import { runSync } from '../src/services/ingestion/sync.js';
import { inferCategory, inferNeighborhood, inferTags } from '../src/services/ingestion/taxonomy.js';
import { isoDay, parseIcsDate, parseDateValue, zonedTimeToUtc } from '../src/services/ingestion/time.js';
import { stripHtml } from '../src/services/ingestion/text.js';
import { eventbriteSource, mapEventbriteEvent } from '../src/services/ingestion/sources/eventbrite.js';
import { getSources } from '../src/services/ingestion/sources/index.js';
import { lumaSource, mapLumaEvent } from '../src/services/ingestion/sources/luma.js';
import { rssSource } from '../src/services/ingestion/sources/rss.js';

// Every test pins "now" so the 120-day sync window never drifts.
const NOW = new Date('2026-10-18T15:00:00Z');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ICS_FIXTURE = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Luma//EN
BEGIN:VEVENT
UID:evt-1@lu.ma
SUMMARY:House Show at Mohawk
DESCRIPTION:Three bands\\, one night. $10 at the door.
LOCATION:Mohawk\\, 912 Red River St\\, Austin\\, TX 78701
DTSTART;TZID=America/Chicago:20261120T200000
DTEND;TZID=America/Chicago:20261120T230000
URL:https://lu.ma/abc123
END:VEVENT
BEGIN:VEVENT
UID:evt-2@lu.ma
SUMMARY:Cancelled thing
DTSTART:20261121T000000Z
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:evt-3@lu.ma
SUMMARY:Morning Zine Swap
DESCRIPTION:All ages
DTSTART:20261115
LOCATION:Far Out Lounge\\, 8504 S Congress Ave\\, Austin\\, TX
END:VEVENT
END:VCALENDAR`;

const RSS_FIXTURE = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>East Austin Happenings</title>
    <item>
      <title><![CDATA[Neighborhood Cleanup + Coffee]]></title>
      <description><![CDATA[<p>Meet at <strong>Cherrywood Coffeehouse</strong> &amp; help tidy the block.</p>]]></description>
      <link>https://example.org/events/cleanup</link>
      <guid>cleanup-2026</guid>
      <startdate>2026-10-24T09:00:00</startdate>
      <media:thumbnail url="https://example.org/cleanup.jpg" />
    </item>
    <item>
      <title>Pottery Workshop</title>
      <description>Hand-built mugs, all levels.</description>
      <link>https://example.org/events/pottery</link>
      <pubDate>Sat, 14 Nov 2026 16:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

function eventbriteEvent(overrides = {}) {
  return {
    id: '101',
    name: { text: 'Indie Night at Mohawk' },
    description: { text: 'Three local bands and a DJ set.' },
    url: 'https://www.eventbrite.com/e/101',
    start: { utc: '2026-11-20T02:00:00Z' },
    end: { utc: '2026-11-20T06:00:00Z' },
    logo: { original: { url: 'https://img.example/101.jpg' } },
    is_free: true,
    status: 'live',
    category_id: '101',
    _embedded: {
      venues: [
        {
          name: 'Mohawk',
          address: {
            address_1: '912 Red River St',
            city: 'Austin',
            region: 'TX',
            postal_code: '78701',
          },
          latitude: '30.2672',
          longitude: '-97.7350',
        },
      ],
      category: { name: 'Music' },
    },
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function textResponse(text, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

const TEST_SOURCE = { id: 'test', label: 'Test calendar' };

function rawEvent(overrides = {}) {
  return {
    externalId: 'ext-1',
    title: 'Basement Art Walk',
    description: 'Small works in a Riverside garage.',
    startAt: '2026-11-01T18:00:00Z',
    address: '1200 E Riverside Dr, Austin, TX',
    city: 'Austin',
    url: 'https://example.org/events/1',
    ...overrides,
  };
}

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
      store.commits.push({ creates: creates.length, updates: updates.length, expired: expired.length });
      return { created: creates.length, updated: updates.length, expired: expired.length, batches: 1 };
    },
    async recordRun(run) {
      store.runs.push(run);
      return `run-${store.runs.length}`;
    },
  };
  return store;
}

function fakeSource({ id = 'fake', label = 'Fake calendar', events = [], fail = null } = {}) {
  const envVar = `${id.toUpperCase()}_ENABLED`;
  return {
    id,
    label,
    kind: 'test',
    envVars: [envVar],
    isConfigured: (env) => env[envVar] === 'yes',
    async fetchEvents() {
      if (fail) throw new Error(fail);
      return events;
    },
  };
}

// ---------------------------------------------------------------------------
// Time handling
// ---------------------------------------------------------------------------

test('floating local times are interpreted as Austin time', () => {
  // Nov 20 2026 is CST (UTC-6): 8pm local == 02:00Z next day.
  const date = parseIcsDate('20261120T200000');
  assert.equal(date.toISOString(), '2026-11-21T02:00:00.000Z');

  const window = parseDateValue('2026-07-04T20:00:00'); // CDT (UTC-5)
  assert.equal(window.toISOString(), '2026-07-05T01:00:00.000Z');

  // Times with an explicit offset must not be shifted.
  assert.equal(
    parseDateValue('2026-11-20T20:00:00-06:00').toISOString(),
    '2026-11-21T02:00:00.000Z',
  );
});

test('zonedTimeToUtc handles the DST boundary', () => {
  // 2026-03-08 03:30 CDT is after the spring-forward jump.
  const afterJump = zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 3, minute: 30 });
  assert.equal(afterJump.toISOString(), '2026-03-08T08:30:00.000Z');
});

test('isoDay buckets by the Austin calendar day', () => {
  assert.equal(isoDay('2026-11-20T02:00:00Z'), '2026-11-19');
});

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

test('parseIcs reads VEVENT fields and unfolds escaped values', () => {
  const events = parseIcs(ICS_FIXTURE);
  assert.equal(events.length, 3);
  assert.equal(events[0].uid, 'evt-1@lu.ma');
  assert.equal(events[0].summary, 'House Show at Mohawk');
  assert.match(events[0].location, /912 Red River St/);
  assert.equal(events[0].startTzid, 'America/Chicago');
  assert.equal(events[1].status, 'CANCELLED');
  assert.equal(events[2].startIsDate, true);
});

test('parseFeed reads RSS items, CDATA, entities, and media', () => {
  const items = parseFeed(RSS_FIXTURE);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Neighborhood Cleanup + Coffee');
  // parseFeed keeps the HTML (feeds often carry markup) and decodes entities;
  // the adapter/normalizer strip it before it reaches Firestore.
  assert.match(items[0].description, /<strong>Cherrywood Coffeehouse<\/strong>/);
  assert.equal(
    stripHtml(items[0].description),
    'Meet at Cherrywood Coffeehouse & help tidy the block.',
  );
  assert.equal(items[0].link, 'https://example.org/events/cleanup');
  assert.equal(items[0].image, 'https://example.org/cleanup.jpg');
  assert.equal(items[0].start, '2026-10-24T09:00:00');
  assert.equal(items[1].title, 'Pottery Workshop');
});

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

test('categories are inferred from title, tags, and external labels', () => {
  assert.equal(inferCategory({ title: 'House Show: three bands' }).category, 'Music/Indie');
  assert.equal(inferCategory({ title: 'Zine making workshop' }).category, 'Workshops');
  assert.equal(inferCategory({ title: 'Saturday market' }).category, 'Pop-ups');
  assert.equal(inferCategory({ title: 'Sunrise yoga' }).category, 'Wellness');
  assert.equal(inferCategory({ title: 'Neighborhood cleanup' }).category, 'Outdoors');
  assert.equal(inferCategory({ externalCategory: 'Food & Drink' }).category, 'Food & Drink');
  assert.equal(inferCategory({ title: 'Mixer' }).category, 'Community');
  // Tags follow vocabulary order (stable across feeds), not title order.
  assert.deepEqual(inferTags({ title: 'Vinyl night + open mic' }), ['vinyl', 'open mic']);
});

test('neighborhoods are inferred from venue, address, and coordinates', () => {
  assert.equal(
    inferNeighborhood({ venue: 'Mohawk', address: '912 Red River St, Austin, TX' }).neighborhood,
    'Downtown',
  );
  assert.equal(
    inferNeighborhood({ address: '8504 S Congress Ave, Austin, TX' }).neighborhood,
    'South Congress',
  );
  assert.equal(
    inferNeighborhood({ address: '2100 E Cesar Chavez St' }).neighborhood,
    'East Austin',
  );
  assert.equal(
    inferNeighborhood({ lat: 30.266, lng: -97.77 }).neighborhood,
    'Zilker',
  );
  assert.equal(inferNeighborhood({ address: '1 Nowhere Rd' }).neighborhood, 'Downtown');
});

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test('normalizes to the Firestore schema with curated provenance', () => {
  const raw = mapEventbriteEvent(eventbriteEvent());
  const { ok, doc } = normalizeIngestedEvent(raw, { id: 'eventbrite', label: 'Eventbrite' }, { now: NOW });

  assert.equal(ok, true);
  assert.equal(doc.title, 'Indie Night at Mohawk');
  assert.equal(doc.category, 'Music/Indie');
  assert.equal(doc.neighborhood, 'Downtown');
  assert.equal(doc.price, 'Free');
  assert.equal(doc.origin, 'curated');
  assert.equal(doc.source, 'eventbrite');
  assert.equal(doc.externalId, '101');
  assert.equal(doc.hostUid, CURATED_HOST_UID);
  assert.equal(doc.attendeeCount, 0);
  assert.match(doc.id, /^eventbrite_[a-z0-9]+$/);
  assert.equal(doc.imageUrl, 'https://img.example/101.jpg');
  assert.equal(doc.sourceUrl, 'https://www.eventbrite.com/e/101');

  // Deterministic id: same input, same document id (idempotent sync).
  const again = normalizeIngestedEvent(raw, { id: 'eventbrite', label: 'Eventbrite' }, { now: NOW });
  assert.equal(again.doc.id, doc.id);
});

test('rejects past, malformed, and out-of-window events', () => {
  const past = normalizeIngestedEvent(
    rawEvent({ startAt: '2026-01-01T00:00:00Z' }),
    TEST_SOURCE,
    { now: NOW },
  );
  assert.equal(past.ok, false);
  assert.match(past.reason, /already ended/);

  const noDate = normalizeIngestedEvent(rawEvent({ startAt: 'not a date' }), TEST_SOURCE, { now: NOW });
  assert.equal(noDate.ok, false);

  const farFuture = normalizeIngestedEvent(
    rawEvent({ startAt: '2027-12-01T00:00:00Z' }),
    TEST_SOURCE,
    { now: NOW },
  );
  assert.equal(farFuture.ok, false);
  assert.match(farFuture.reason, /beyond the sync window/);

  const noId = normalizeIngestedEvent(rawEvent({ externalId: '' }), TEST_SOURCE, { now: NOW });
  assert.equal(noId.ok, false);
});

test('normalization strips HTML from feed descriptions', () => {
  const { doc } = normalizeIngestedEvent(
    rawEvent({ description: '<p>Hello <b>world</b> &amp; friends</p>' }),
    TEST_SOURCE,
    { now: NOW },
  );
  assert.equal(doc.description, 'Hello world & friends');
});

// ---------------------------------------------------------------------------
// Source adapters
// ---------------------------------------------------------------------------

test('eventbrite adapter scopes the search to Austin and drops unusable events', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      pagination: { has_more_items: false },
      events: [
        eventbriteEvent(),
        eventbriteEvent({ id: '102', name: { text: 'Parking pass' }, status: 'canceled' }),
        eventbriteEvent({ id: '103', name: { text: 'Online workshop' }, online_event: true }),
        eventbriteEvent({
          id: '104',
          name: { text: 'Dallas meetup' },
          _embedded: { venues: [{ name: 'Venue', address: { city: 'Dallas' } }] },
        }),
        eventbriteEvent({ id: '105', name: { text: 'Virtual event: webinar for founders' } }),
        eventbriteEvent({
          id: '106',
          name: { text: 'Austin label, far venue' },
          _embedded: {
            venues: [
              {
                name: 'Far away',
                address: { city: 'Austin' },
                latitude: '32.7767',
                longitude: '-96.7970',
              },
            ],
          },
        }),
      ],
    });
  };

  const events = await eventbriteSource.fetchEvents({
    env: { EVENTBRITE_API_TOKEN: 'token-123' },
    fetchImpl,
    now: NOW,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].externalId, '101');
  const [call] = calls;
  assert.match(call.url, /location\.address=Austin%2C\+TX/);
  assert.match(call.url, /location\.within=25mi/);
  // Default category scope: music, arts, outdoor, food, community, family.
  assert.match(call.url, /categories=101%2C103%2C107%2C108%2C111%2C112/);
  assert.equal(call.options.headers.authorization, 'Bearer token-123');
});

test('eventbrite adapter follows organizers with the API key', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      pagination: { has_more_items: false },
      events: [eventbriteEvent()],
    });
  };

  const events = await eventbriteSource.fetchEvents({
    env: { EVENTBRITE_API_KEY: 'key-abc', EVENTBRITE_ORGANIZERS: '42, 43' },
    fetchImpl,
    now: NOW,
  });

  // Both organizers return event 101; the adapter dedupes by external id.
  assert.equal(events.length, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/organizations\/42\/events\//);
  assert.match(calls[1].url, /\/organizations\/43\/events\//);
  assert.equal(calls[0].options.headers.authorization, 'Bearer key-abc');
});

test('eventbrite adapter caps a run and keeps only fresh local events', async () => {
  const events = [
    eventbriteEvent({ id: '201', name: { text: 'Free Webinar: grow your brand' } }),
    eventbriteEvent({
      id: '202',
      name: { text: 'Austin listing, Dallas venue' },
      _embedded: {
        venues: [
          {
            name: 'Far away',
            address: { city: 'Austin' },
            latitude: '32.7767',
            longitude: '-96.7970',
          },
        ],
      },
    }),
    ...Array.from({ length: 12 }, (_, index) =>
      eventbriteEvent({ id: String(300 + index), name: { text: `Indie show ${index}` } }),
    ),
  ];

  const got = await eventbriteSource.fetchEvents({
    env: { EVENTBRITE_API_KEY: 'key', EVENTBRITE_MAX_EVENTS: '5' },
    fetchImpl: async () => jsonResponse({ pagination: { has_more_items: false }, events }),
    now: NOW,
  });

  assert.deepEqual(
    got.map((event) => event.externalId),
    ['300', '301', '302', '303', '304'],
  );
});

test('eventbrite adapter translates rate limits into an actionable error', async () => {
  let calls = 0;
  await assert.rejects(
    eventbriteSource.fetchEvents({
      env: { EVENTBRITE_API_KEY: 'key' },
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ error: 'too many requests' }, 429);
      },
      now: NOW,
    }),
    /rate limit reached \(429\)/,
  );
  // The shared HTTP helper retries transient statuses exactly once.
  assert.equal(calls, 2);
});

test('source registry can exclude a source for one run', () => {
  const env = { EVENTBRITE_API_KEY: 'key', SYNC_FIXTURES: '1' };
  assert.deepEqual(
    getSources(env).map((source) => source.id),
    ['eventbrite', 'fixture'],
  );
  assert.deepEqual(
    getSources(env, { exclude: ['eventbrite'] }).map((source) => source.id),
    ['fixture'],
  );
});

test('eventbrite adapter explains a bad token', async () => {
  await assert.rejects(
    eventbriteSource.fetchEvents({
      env: { EVENTBRITE_API_TOKEN: 'nope' },
      fetchImpl: async () => jsonResponse({ error: 'unauthorized' }, 401),
      now: NOW,
    }),
    /rejected the token \(401\)/,
  );
});

test('luma adapter reads the calendar ICS feed and skips cancellations', async () => {
  const fetchImpl = async () => textResponse(ICS_FIXTURE);
  const events = await lumaSource.fetchEvents({
    env: { LUMA_CALENDARS: 'austinindie' },
    fetchImpl,
    now: NOW,
  });

  assert.equal(events.length, 2); // cancelled one is dropped
  assert.equal(events[0].title, 'House Show at Mohawk');
  assert.equal(events[0].venueName, 'Mohawk');
  assert.equal(events[0].externalId, 'evt-1@lu.ma');
  assert.equal(events[0].startAt.toISOString(), '2026-11-21T02:00:00.000Z');
});

test('luma adapter accepts full ICS URLs', async () => {
  const urls = [];
  await lumaSource.fetchEvents({
    env: { LUMA_CALENDARS: 'https://lu.ma/custom/feed.ics' },
    fetchImpl: async (url) => {
      urls.push(url);
      return textResponse('BEGIN:VCALENDAR\nEND:VCALENDAR');
    },
    now: NOW,
  });
  assert.equal(urls[0], 'https://lu.ma/custom/feed.ics');
});

test('rss adapter maps feed items into raw events', async () => {
  const events = await rssSource.fetchEvents({
    env: { RSS_FEEDS: 'https://example.org/feed.xml' },
    fetchImpl: async () => textResponse(RSS_FIXTURE),
    now: NOW,
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].title, 'Neighborhood Cleanup + Coffee');
  assert.equal(events[0].startAt.toISOString(), '2026-10-24T14:00:00.000Z');
  assert.equal(events[0].externalId, 'cleanup-2026');
  assert.equal(events[1].externalId, 'https://example.org/events/pottery');
});

test('mapLumaEvent keeps location text for neighborhood inference', () => {
  const [first] = parseIcs(ICS_FIXTURE);
  const raw = mapLumaEvent(first, { timeZone: 'America/Chicago' });
  const { doc } = normalizeIngestedEvent(raw, { id: 'luma', label: 'Luma' }, { now: NOW });
  assert.equal(doc.neighborhood, 'Downtown');
  assert.equal(doc.category, 'Music/Indie');
});

// ---------------------------------------------------------------------------
// Dedupe planner
// ---------------------------------------------------------------------------

test('diffSyncedFields ignores identical data and reports real changes', () => {
  const doc = {
    title: 'A',
    tags: ['x'],
    startAt: new Date('2026-11-01T18:00:00Z'),
    description: '',
  };
  const same = { ...doc, startAt: new Date('2026-11-01T18:00:00Z') };
  assert.deepEqual(diffSyncedFields(doc, same).changed, []);

  const changed = diffSyncedFields({ ...doc, title: 'B' }, same);
  assert.deepEqual(changed.changed, ['title']);
  assert.equal(changed.patch.title, 'B');
});

test('titleDateKey matches the same event across calendars', () => {
  const a = titleDateKey('Indie Night at Mohawk', '2026-11-20T02:00:00Z');
  const b = titleDateKey('indie night at mohawk!', new Date('2026-11-20T02:00:00Z'));
  assert.equal(a, b);
});

test('planSync creates, updates by external id, and skips duplicates', () => {
  const existing = [
    {
      id: 'luma_a',
      origin: 'curated',
      source: 'luma',
      externalId: 'evt-1',
      title: 'House Show',
      startAt: new Date('2026-11-21T02:00:00Z'),
      description: 'old',
      tags: [],
    },
  ];
  const incoming = [
    {
      id: 'luma_a',
      source: 'luma',
      externalId: 'evt-1',
      title: 'House Show',
      startAt: new Date('2026-11-21T02:00:00Z'),
      description: 'new description',
      tags: [],
    },
    {
      id: 'luma_b',
      source: 'luma',
      externalId: 'evt-2',
      title: 'Zine Swap',
      startAt: new Date('2026-11-15T15:00:00Z'),
      tags: [],
    },
  ];

  const plan = planSync({ incoming, existing, now: NOW });
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].id, 'luma_b');
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, 'luma_a');
  assert.deepEqual(plan.updates[0].changed, ['description']);
});

test('planSync never overwrites a neighbor post', () => {
  const existing = [
    {
      id: 'community_1',
      origin: 'community',
      title: 'House Show',
      startAt: new Date('2026-11-21T02:00:00Z'),
    },
  ];
  const incoming = [
    {
      id: 'luma_x',
      source: 'luma',
      externalId: 'evt-1',
      title: 'House Show',
      startAt: new Date('2026-11-21T02:00:00Z'),
    },
  ];

  const plan = planSync({ incoming, existing, now: NOW });
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.skipped[0].reason, 'already posted by a neighbor');
});

test('planSync keeps the first curated copy when calendars overlap', () => {
  const existing = [
    {
      id: 'luma_1',
      origin: 'curated',
      source: 'luma',
      externalId: 'a',
      title: 'Same Show',
      startAt: new Date('2026-11-10T02:00:00Z'),
    },
  ];
  const incoming = [
    {
      id: 'rss_1',
      source: 'rss',
      externalId: 'b',
      title: 'Same Show',
      startAt: new Date('2026-11-10T02:00:00Z'),
    },
  ];

  const plan = planSync({ incoming, existing, now: NOW });
  assert.equal(plan.creates.length, 0);
  assert.match(plan.skipped[0].reason, /already curated from luma/);
});

test('planSync expires old curated rows only from sources that ran', () => {
  const existing = [
    { id: 'luma_old', origin: 'curated', source: 'luma', title: 'Old', startAt: new Date('2026-09-01T00:00:00Z') },
    { id: 'rss_old', origin: 'curated', source: 'rss', title: 'Other', startAt: new Date('2026-09-01T00:00:00Z') },
    { id: 'community_old', origin: 'community', title: 'Neighbor', startAt: new Date('2026-09-01T00:00:00Z') },
  ];

  const plan = planSync({
    incoming: [],
    existing,
    now: NOW,
    pruneExpired: true,
    activeSourceIds: ['luma'],
  });

  assert.deepEqual(plan.expired.map((row) => row.id), ['luma_old']);
});

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

test('runSync writes once, then becomes a no-op on identical input', async () => {
  const source = fakeSource({
    events: [
      rawEvent(),
      rawEvent({ externalId: 'ext-2', title: 'Riverside Potluck', startAt: '2026-11-02T23:00:00Z' }),
    ],
  });
  const store = createMemoryStore();
  const env = { FAKE_ENABLED: 'yes' };

  const first = await runSync({ sources: [source], store, env, now: NOW, trigger: 'test' });
  assert.equal(first.totals.created, 2);
  assert.equal(first.totals.skipped, 0);
  assert.equal(store.rows.size, 2);
  assert.equal(store.runs.length, 1);
  assert.equal(store.runs[0].trigger, 'test');

  const second = await runSync({ sources: [source], store, env, now: NOW, trigger: 'test' });
  assert.equal(second.totals.created, 0);
  assert.equal(second.totals.unchanged, 2);
  assert.equal(store.commits.length, 1); // no second write at all
});

test('runSync updates changed fields without changing document ids', async () => {
  const events = [rawEvent()];
  const store = createMemoryStore();
  const env = { FAKE_ENABLED: 'yes' };

  await runSync({ sources: [fakeSource({ events })], store, env, now: NOW });
  const [firstId] = [...store.rows.keys()];

  events[0] = rawEvent({ title: 'Basement Art Walk (night two)' });
  const second = await runSync({ sources: [fakeSource({ events })], store, env, now: NOW });

  assert.equal(second.totals.updated, 1);
  assert.equal(store.rows.size, 1);
  assert.equal(store.rows.get(firstId).title, 'Basement Art Walk (night two)');
});

test('runSync isolates failing sources and reports them', async () => {
  const good = fakeSource({ id: 'good', events: [rawEvent()] });
  const bad = fakeSource({ id: 'bad', fail: 'feed is down' });
  const store = createMemoryStore();

  const run = await runSync({
    sources: [good, bad],
    store,
    env: { GOOD_ENABLED: 'yes', BAD_ENABLED: 'yes' },
    now: NOW,
  });

  assert.equal(run.totals.created, 1);
  const badReport = run.sources.find((source) => source.id === 'bad');
  assert.equal(badReport.ok, false);
  assert.match(badReport.error, /feed is down/);
});

test('runSync marks unconfigured sources without failing the run', async () => {
  const store = createMemoryStore();
  const run = await runSync({
    sources: [fakeSource({ id: 'ghost' })],
    store,
    env: {},
    now: NOW,
  });

  assert.equal(run.sources[0].configured, false);
  assert.match(run.sources[0].error, /GHOST_ENABLED/);
});

test('runSync dry run never writes or records a run', async () => {
  const store = createMemoryStore();
  const run = await runSync({
    sources: [fakeSource({ events: [rawEvent()] })],
    store,
    env: { FAKE_ENABLED: 'yes' },
    now: NOW,
    dryRun: true,
  });

  assert.equal(run.planned.creates, 1);
  assert.equal(run.totals.created, 0);
  assert.equal(store.rows.size, 0);
  assert.equal(store.commits.length, 0);
  assert.equal(store.runs.length, 0);
});

test('runSync caps events per source and surfaces invalid rows', async () => {
  const events = [
    rawEvent({ externalId: 'a', title: 'One', startAt: '2026-11-01T18:00:00Z' }),
    rawEvent({ externalId: 'b', title: 'Two', startAt: '2026-11-02T18:00:00Z' }),
    rawEvent({ externalId: 'c', title: 'Past', startAt: '2026-01-01T18:00:00Z' }),
  ];
  const store = createMemoryStore();
  const run = await runSync({
    sources: [fakeSource({ events })],
    store,
    env: { FAKE_ENABLED: 'yes' },
    now: NOW,
    maxPerSource: 2,
  });

  assert.equal(run.sources[0].invalid, 0);
  assert.equal(run.totals.created, 2);
  assert.match(run.warnings.join(' '), /capped at 2/);
});

test('runSync prunes expired curated rows and leaves community posts alone', async () => {
  const now = new Date('2026-11-20T00:00:00Z');
  const store = createMemoryStore([
    {
      id: 'luma_old',
      origin: 'curated',
      source: 'fake',
      externalId: 'old-1',
      title: 'Past curated show',
      startAt: new Date('2026-10-01T00:00:00Z'),
    },
    {
      id: 'community_old',
      origin: 'community',
      title: 'Neighbor post',
      startAt: new Date('2026-10-01T00:00:00Z'),
    },
  ]);

  const run = await runSync({
    sources: [fakeSource({ events: [] })],
    store,
    env: { FAKE_ENABLED: 'yes' },
    now,
    pruneExpired: true,
  });

  assert.equal(run.totals.expired, 1);
  assert.equal(store.rows.has('luma_old'), false);
  assert.equal(store.rows.has('community_old'), true);
});

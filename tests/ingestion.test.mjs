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
import {
  calendarsSource,
  mapIcsCalendarEvent,
  mapJsonLdEvent,
  parseJsonLdEvents,
  DEFAULT_CALENDAR_URLS,
} from '../src/services/ingestion/sources/calendars.js';
import { do512Source, parseDo512Page } from '../src/services/ingestion/sources/do512.js';
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

// Shape returned by POST /v3/destination/search/ (the public discovery feed).
function eventbriteSearchResult(overrides = {}) {
  return {
    id: '901',
    name: 'Sunset Sweat at Zilker',
    summary: 'Free outdoor workout.',
    start_date: '2026-11-21',
    start_time: '09:00',
    end_date: '2026-11-21',
    end_time: '10:00',
    timezone: 'America/Chicago',
    url: 'https://www.eventbrite.com/e/901',
    is_cancelled: null,
    is_online_event: false,
    locations: [
      { id: '85688753', type: 'region', name: 'Texas' },
      { id: '101724577', type: 'locality', name: 'Austin' },
      { id: '85867199', type: 'neighbourhood', name: 'Zilker' },
    ],
    tags: [
      { display_name: 'Travel & Outdoor', prefix: 'EventbriteCategory', tag: 'EventbriteCategory/107' },
      { display_name: 'Austin', prefix: 'OrganizerTag', tag: 'OrganizerTag/Austin' },
    ],
    ...overrides,
  };
}

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

test('eventbrite discovery search posts the Austin place and drops unusable events', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      events: {
        pagination: { object_count: 6, page_count: 1, page_number: 1 },
        results: [
          eventbriteSearchResult(),
          eventbriteSearchResult({ id: '902', is_cancelled: true, name: 'Cancelled mixer' }),
          eventbriteSearchResult({ id: '903', is_online_event: true, name: 'Online workshop' }),
          eventbriteSearchResult({
            id: '904',
            name: 'Dallas meetup',
            locations: [
              { id: '85688753', type: 'region', name: 'Texas' },
              { id: '101724573', type: 'locality', name: 'Dallas' },
            ],
          }),
          eventbriteSearchResult({ id: '905', name: 'Virtual event: webinar for founders' }),
          eventbriteSearchResult({
            id: '906',
            name: 'Business networking breakfast',
            tags: [
              {
                display_name: 'Business & Professional',
                prefix: 'EventbriteCategory',
                tag: 'EventbriteCategory/113',
              },
            ],
          }),
        ],
      },
    });
  };

  const events = await eventbriteSource.fetchEvents({
    env: { EVENTBRITE_API_TOKEN: 'token-123' },
    fetchImpl,
    now: NOW,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].externalId, '901');
  // 09:00 wall clock in Austin is 15:00 UTC once DST has ended.
  assert.equal(events[0].startAt, '2026-11-21T15:00:00.000Z');
  assert.equal(events[0].externalCategory, 'Travel & Outdoor');
  assert.equal(events[0].address, 'Zilker, Austin, TX');

  const [call] = calls;
  assert.match(call.url, /\/destination\/search\/$/);
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers.authorization, 'Bearer token-123');
  const body = JSON.parse(call.options.body);
  assert.deepEqual(body.event_search.places, ['101724577']);
  assert.equal(body.event_search.dates, 'current_future');
  assert.equal(body.event_search.page, 1);
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

test('eventbrite discovery honours EVENTBRITE_MAX_EVENTS', async () => {
  const results = [
    eventbriteSearchResult({ id: '201', name: 'Free Webinar: grow your brand' }),
    ...Array.from({ length: 12 }, (_, index) =>
      eventbriteSearchResult({
        id: String(300 + index),
        name: `Indie show ${index}`,
        start_time: '20:00',
        end_time: '23:00',
      }),
    ),
  ];

  const got = await eventbriteSource.fetchEvents({
    env: { EVENTBRITE_API_KEY: 'key', EVENTBRITE_MAX_EVENTS: '5' },
    fetchImpl: async () =>
      jsonResponse({
        events: { pagination: { object_count: results.length, page_count: 2 }, results },
      }),
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
  // Do512 needs no credentials, so it is always in the run.
  assert.deepEqual(
    getSources(env).map((source) => source.id),
    ['eventbrite', 'do512', 'calendars', 'fixture'],
  );
  assert.deepEqual(
    getSources(env, { exclude: ['eventbrite'] }).map((source) => source.id),
    ['do512', 'calendars', 'fixture'],
  );
  assert.deepEqual(
    getSources({ EVENTBRITE_API_TOKEN: 'legacy-name' }).map((source) => source.id),
    ['eventbrite', 'do512', 'calendars'],
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

// Real Do512 markup, trimmed to the fields the adapter reads.
const DO512_FIXTURE = `
<div class="ds-listing event-card ds-event-category-live-music" data-permalink="/events/2026/10/20/house-show-at-mohawk" itemprop="event" itemscope itemtype="http://schema.org/Event">
  <div class="ds-cover-image" style="background-image:url('https://assets0.example/mohawk.jpg');"></div>
  <a href="/events/2026/10/20/house-show-at-mohawk" itemprop="url" class="ds-listing-event-title url summary">
    <span class="ds-byline"></span>
    <span class="ds-listing-event-title-text" itemprop="name">House Show at Mohawk</span>
  </a>
  <div class="ds-listing-details">
    <div class="ds-venue-name" itemprop="location" itemscope itemtype="http://schema.org/Place">
      <a href="/venues/mohawk" itemprop="url"><span itemprop="name">Mohawk</span></a>
      <span itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
        <meta itemprop="streetAddress" content="912 Red River St" />
        <meta itemprop="addressLocality" content="Austin" />
        <meta itemprop="addressRegion" content="TX" />
        <meta itemprop="postalCode" content="78701" />
      </span>
    </div>
    <meta itemprop="startDate" datetime="2026-10-20T20:00-0500" content="2026-10-20T20:00-0500"/>
  </div>
</div>
<div class="ds-listing event-card ds-event-category-online-stream" data-permalink="/events/2026/10/20/virtual-zine-workshop" itemprop="event" itemscope itemtype="http://schema.org/Event">
  <span class="ds-listing-event-title-text" itemprop="name">Virtual Zine Workshop</span>
  <meta itemprop="startDate" datetime="2026-10-20T18:00-0500" content="2026-10-20T18:00-0500"/>
</div>
<div class="ds-listing event-card ds-event-category-art-culture" data-permalink="/events/2026/10/21/round-rock-art-fair" itemprop="event" itemscope itemtype="http://schema.org/Event">
  <span class="ds-listing-event-title-text" itemprop="name">Round Rock Art Fair</span>
  <div itemprop="location" itemscope itemtype="http://schema.org/Place">
    <span itemprop="name">Old Settlers Park</span>
    <meta itemprop="addressLocality" content="Round Rock" />
  </div>
  <meta itemprop="startDate" datetime="2026-10-21T10:00-0500" content="2026-10-21T10:00-0500"/>
</div>
<div class="ds-listing event-card ds-event-category-karaoke-trivia" data-permalink="/events/weekly/tue/trivia-tuesdays-tickets" itemprop="event" itemscope itemtype="http://schema.org/Event">
  <ul class="ds-listing-banners"><li class="ds-listing-series">Free - Every Tue</li></ul>
  <span class="ds-listing-event-title-text" itemprop="name">Trivia Tuesdays</span>
  <div itemprop="location" itemscope itemtype="http://schema.org/Place">
    <span itemprop="name">Nomadic Outpost</span>
    <meta itemprop="addressLocality" content="Austin" />
  </div>
  <div class="ds-event-time dtstart">7:00PM</div>
  <meta itemprop="startDate" datetime="2026-05-19T19:00-0500" content="2026-05-19T19:00-0500"/>
  <meta itemprop="endDate" datetime="2026-05-19T21:00-0500" content="2026-05-19T21:00-0500"/>
</div>
<div class="ds-listing event-card ds-event-category-art-culture" data-permalink="/events/2026/9/26/central-tx-pumpkin-fest-tickets" itemprop="event" itemscope itemtype="http://schema.org/Event">
  <span class="ds-listing-event-title-text" itemprop="name">Central TX Pumpkin Fest</span>
  <div itemprop="location" itemscope itemtype="http://schema.org/Place">
    <span itemprop="name">Sweet Eats Fruit Farm</span>
    <meta itemprop="addressLocality" content="Austin" />
  </div>
  <meta itemprop="startDate" datetime="2026-09-26T12:00-0500" content="2026-09-26T12:00-0500"/>
  <meta itemprop="endDate" datetime="2026-11-02T18:00-0600" content="2026-11-02T18:00-0600"/>
</div>
<div class="ds-listing event-card ds-event-category-live-music" data-permalink="/events/2026/10/22/date-tba" itemprop="event" itemscope itemtype="http://schema.org/Event">
  <span class="ds-listing-event-title-text" itemprop="name">Date TBA Listening Party</span>
</div>
`;

test('do512 re-dates recurring series onto the day page they were listed on', () => {
  // A weekly card carries the *series* start (the first Tuesday it ever ran),
  // which would otherwise be thrown away as already-ended.
  const weekly = (pageDay) =>
    parseDo512Page(DO512_FIXTURE, { pageDay }).find((event) => event.title === 'Trivia Tuesdays');

  const moved = weekly('2026-10-18');
  assert.equal(moved.startAt, '2026-10-18T19:00');
  assert.equal(moved.endAt, '2026-10-18T21:00');

  // Without a page day there is nothing to re-date onto, so the series start
  // is left alone rather than guessed at.
  assert.equal(weekly('').startAt, '2026-05-19T19:00-0500');

  // A dated permalink (even unpadded, as the pumpkin fest uses) is a one-off
  // listing, so its own start date stands however old it is.
  const fest = parseDo512Page(DO512_FIXTURE, { pageDay: '2026-10-18' }).find(
    (event) => event.title === 'Central TX Pumpkin Fest',
  );
  assert.equal(fest.startAt, '2026-09-26T12:00-0500');
});

test('do512 adapter reads schema.org microdata and keeps Austin only', async () => {
  const parsed = parseDo512Page(DO512_FIXTURE);
  // The online-stream card is dropped, and so is the one with no start date.
  assert.deepEqual(
    parsed.map((event) => event.title),
    [
      'House Show at Mohawk',
      'Round Rock Art Fair',
      'Trivia Tuesdays',
      'Central TX Pumpkin Fest',
    ],
  );

  const [house] = parsed;
  assert.equal(house.externalId, '/events/2026/10/20/house-show-at-mohawk');
  assert.equal(house.startAt, '2026-10-20T20:00-0500');
  assert.equal(house.venueName, 'Mohawk');
  assert.equal(house.address, '912 Red River St, Austin, TX, 78701');
  assert.equal(house.city, 'Austin');
  assert.equal(house.externalCategory, 'Music');
  assert.equal(house.url, 'https://do512.com/events/2026/10/20/house-show-at-mohawk');
  assert.equal(house.imageUrl, 'https://assets0.example/mohawk.jpg');

  // Non-Austin cities are dropped by the adapter, not just by the parser.
  const calls = [];
  const events = await do512Source.fetchEvents({
    env: { DO512_DAYS: '1' },
    now: NOW,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return textResponse(DO512_FIXTURE);
    },
    logger: { warn: () => {}, debug: () => {} },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://do512.com/events/2026/10/18');
  // Do512 403s an obvious bot agent, so the adapter has to identify as a browser.
  assert.match(calls[0].init.headers['user-agent'], /Mozilla/);
  // Round Rock is dropped; the weekly series is re-dated onto the page day
  // (2026-10-18) so it clears the past-date check instead of being rejected.
  assert.deepEqual(
    events.map((event) => event.title),
    ['House Show at Mohawk', 'Trivia Tuesdays', 'Central TX Pumpkin Fest'],
  );
  const normalized = events.map((event) =>
    normalizeIngestedEvent(event, do512Source, { now: NOW }),
  );
  assert.deepEqual(normalized.map((result) => result.ok), [true, true, true]);
  assert.equal(normalized[1].doc.startAt.toISOString(), '2026-10-19T00:00:00.000Z');

  const { ok, doc } = normalized[0];
  assert.equal(ok, true);
  assert.equal(doc.neighborhood, 'Downtown');
  assert.equal(doc.category, 'Music/Indie');
  assert.equal(doc.source, 'do512');
  assert.equal(doc.origin, 'curated');
});

test('ongoing multi-day listings survive the past-date check', () => {
  const { ok } = normalizeIngestedEvent(
    rawEvent({ startAt: '2026-10-16T18:00:00Z', endAt: '2026-10-21T23:00:00Z' }),
    TEST_SOURCE,
    { now: NOW },
  );
  assert.equal(ok, true);
});

test('luma adapter reports a calendar link that is not a feed', async () => {
  await assert.rejects(
    lumaSource.fetchEvents({
      env: { LUMA_CALENDARS: 'austinindie' },
      fetchImpl: async () => textResponse('<!DOCTYPE html><html>calendar page</html>'),
      now: NOW,
    }),
    /did not return an iCalendar feed/,
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

// Real schema.org markup shape (Tribe Events on WordPress): one @graph block
// holding a nested array of Event objects.
const CALENDAR_JSONLD_FIXTURE = `<!DOCTYPE html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Austin Parks Foundation"}</script>
<script type="application/ld+json">{"@context":"http://schema.org","@graph":[
  {"@type":"WebPage","name":"Events"},
  [
    {"@type":"Event","name":"Greenbelt Restoration Day",
     "startDate":"2026-11-14T09:00:00-06:00","endDate":"2026-11-14T12:00:00-06:00",
     "url":"https://austinparks.org/events/greenbelt-11-14/",
     "description":"&lt;p&gt;Plant natives with the parks crew.&lt;/p&gt;",
     "image":"https://austinparks.org/media/greenbelt.jpg",
     "location":{"@type":"Place","name":"Violet Crown Trailhead","address":"1336 William Barton Dr, Austin, TX 78746"},
     "offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}},
    {"@type":"Event","name":"Cancelled Creek Cleanup","startDate":"2026-11-15T09:00:00-06:00",
     "eventStatus":"https://schema.org/EventCancelled"},
    {"@type":"Event","name":"Dallas Bike Ride","startDate":"2026-11-16T09:00:00-06:00",
     "location":{"@type":"Place","name":"Fair Park","address":{"@type":"PostalAddress","streetAddress":"921 S Haskell Ave","addressLocality":"Dallas","addressRegion":"TX"}}},
    {"@type":"Event","name":"An Evening With Local Poets",
     "startDate":"2026-11-1T18:00-5:00","url":"https://example.org/poets",
     "location":{"@type":"Place","name":"BookWoman","address":{"@type":"PostalAddress","streetAddress":"5501 N Lamar Blvd","addressLocality":"Austin","addressRegion":"TX","postalCode":"78751"}},
     "offers":[{"@type":"Offer","price":"12.5"}]},
    {"@type":"Event","name":"Online Only Panel","startDate":"2026-11-18T18:00:00-06:00",
     "eventAttendanceMode":"https://schema.org/OnlineEventAttendanceMode"}
  ]
]}</script></head><body></body></html>`;

test('parseJsonLdEvents digs events out of @graph blocks and nested lists', () => {
  assert.deepEqual(
    parseJsonLdEvents(CALENDAR_JSONLD_FIXTURE).map((node) => node.name),
    [
      'Greenbelt Restoration Day',
      'Cancelled Creek Cleanup',
      'Dallas Bike Ride',
      'An Evening With Local Poets',
      'Online Only Panel',
    ],
  );
  // A page with no JSON-LD yields nothing rather than throwing.
  assert.deepEqual(parseJsonLdEvents('<html><body>no markup</body></html>'), []);
});

test('mapJsonLdEvent reads place, price, and repairs loose schema.org dates', () => {
  const nodes = parseJsonLdEvents(CALENDAR_JSONLD_FIXTURE);
  const byTitle = Object.fromEntries(
    nodes.map((node) => [node.name, mapJsonLdEvent(node, { pageUrl: 'https://austinparks.org/events/' })]),
  );

  const greenbelt = byTitle['Greenbelt Restoration Day'];
  // Local calendars are trusted for wall-clock time, not for the offset they
  // publish (Austin is -06:00 in November, but calendars hard-code -05:00).
  assert.equal(greenbelt.startAt, '2026-11-14T09:00:00');
  assert.equal(greenbelt.timeTba, false);
  assert.equal(greenbelt.venueName, 'Violet Crown Trailhead');
  assert.equal(greenbelt.address, '1336 William Barton Dr, Austin, TX 78746');
  assert.equal(greenbelt.city, 'Austin');
  assert.equal(greenbelt.price, 'Free');
  assert.equal(greenbelt.description, 'Plant natives with the parks crew.');
  assert.equal(greenbelt.externalId, 'https://austinparks.org/events/greenbelt-11-14/');

  // Unpadded month/day and a single-digit offset are repairable.
  assert.equal(byTitle['An Evening With Local Poets'].startAt, '2026-11-01T18:00:00');
  assert.equal(byTitle['An Evening With Local Poets'].price, '$12.50');
  assert.equal(byTitle['An Evening With Local Poets'].venueName, 'BookWoman');

  // Cancelled and online-only listings are never imported.
  assert.equal(byTitle['Cancelled Creek Cleanup'], null);
  assert.equal(byTitle['Online Only Panel'], null);
});

test('calendars adapter reads JSON-LD and iCal pages and keeps Austin only', async () => {
  const calls = [];
  const events = await calendarsSource.fetchEvents({
    env: {
      CALENDAR_DEFAULTS: 'off',
      CALENDAR_URLS: 'https://austinparks.org/events/,https://theaustincommon.com/events/?ical=1',
    },
    fetchImpl: async (url) => {
      calls.push(url);
      return textResponse(url.includes('ical=1') ? ICS_FIXTURE : CALENDAR_JSONLD_FIXTURE);
    },
    logger: { warn: () => {}, debug: () => {} },
  });

  assert.deepEqual(calls, [
    'https://austinparks.org/events/',
    'https://theaustincommon.com/events/?ical=1',
  ]);
  // Dallas and the two cancelled/online listings are dropped; the date-only
  // zine swap survives with timeTba so the UI does not claim 12:00 AM.
  assert.deepEqual(
    events.map((event) => event.title),
    ['Greenbelt Restoration Day', 'An Evening With Local Poets', 'House Show at Mohawk', 'Morning Zine Swap'],
  );
  assert.equal(events[3].timeTba, true);
  assert.equal(events[2].timeTba, false);

  const normalized = events.map((event) => normalizeIngestedEvent(event, calendarsSource, { now: NOW }));
  assert.deepEqual(normalized.map((result) => result.ok), [true, true, true, true]);
  assert.equal(normalized[3].doc.timeTba, true);
  assert.equal(normalized[0].doc.source, 'calendars');
  assert.equal(normalized[0].doc.origin, 'curated');
  // "1336 William Barton Dr" is the only locator on the listing.
  assert.equal(normalized[0].doc.neighborhood, 'Barton Hills');
});

test('calendars source ships Austin seeds and appends CALENDAR_URLS', async () => {
  assert.equal(calendarsSource.isConfigured({}), true);
  assert.equal(new Set(DEFAULT_CALENDAR_URLS).size, DEFAULT_CALENDAR_URLS.length);
  for (const url of DEFAULT_CALENDAR_URLS) assert.match(url, /^https:\/\//);
  // The seeds verified against live markup, so a rewrite cannot quietly drop one.
  for (const url of [
    'https://theaustincommon.com/events/?ical=1',
    'https://austinparks.org/events/',
    'https://www.sustainablefoodcenter.org/events',
    // Read as iCal: the HTML page is behind a Cloudflare challenge for
    // datacenter IPs, which is how the scheduled run reaches it.
    'https://www.wildflower.org/events/?ical=1',
    'https://www.shalomaustin.org/events',
    'https://www.austinbatcave.org/events',
  ]) {
    assert.ok(DEFAULT_CALENDAR_URLS.includes(url), `missing seed ${url}`);
  }

  const calls = [];
  await calendarsSource.fetchEvents({
    env: { CALENDAR_URLS: 'https://example.org/events/' },
    fetchImpl: async (url) => {
      calls.push(url);
      return textResponse('<html></html>');
    },
    logger: { warn: () => {}, debug: () => {} },
  });
  assert.deepEqual(calls, [...DEFAULT_CALENDAR_URLS, 'https://example.org/events/']);

  // One broken page must not sink the others.
  const resilient = await calendarsSource.fetchEvents({
    env: { CALENDAR_DEFAULTS: 'off', CALENDAR_URLS: 'https://broken.example/events/,https://austinparks.org/events/' },
    fetchImpl: async (url) => {
      if (url.includes('broken')) throw new Error('HTTP 403');
      return textResponse(CALENDAR_JSONLD_FIXTURE);
    },
    logger: { warn: () => {}, debug: () => {} },
  });
  assert.equal(resilient.length, 2);

  // Turning the seeds off without supplying any URLs is a configuration error,
  // not a successful run that found nothing.
  await assert.rejects(
    calendarsSource.fetchEvents({
      env: { CALENDAR_DEFAULTS: 'off' },
      fetchImpl: async () => textResponse('<html></html>'),
      logger: { warn: () => {}, debug: () => {} },
    }),
    /CALENDAR_DEFAULTS is off and CALENDAR_URLS is empty/,
  );
});

// Cloudflare's interstitial as wildflower.org serves it to datacenter IPs.
const BOT_CHALLENGE_HTML =
  '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head>' +
  '<body><div id="cf-chl-widget"><h1>Enable JavaScript and cookies to continue</h1></div></body></html>';
const CHALLENGED_CALENDAR_URL = 'https://www.wildflower.org/events/';

function challengeResponse(status = 403) {
  return textResponse(BOT_CHALLENGE_HTML, status);
}

test('a challenged calendar page falls back to its iCal export', async () => {
  const calls = [];
  const events = await calendarsSource.fetchEvents({
    env: { CALENDAR_DEFAULTS: 'off', CALENDAR_URLS: CHALLENGED_CALENDAR_URL },
    fetchImpl: async (url) => {
      calls.push(url);
      return url.includes('ical=1') ? textResponse(ICS_FIXTURE) : challengeResponse();
    },
    logger: { warn: () => {}, debug: () => {} },
  });

  // The cancelled listing is dropped, the two Austin ones survive.
  assert.deepEqual(
    events.map((event) => event.title),
    ['House Show at Mohawk', 'Morning Zine Swap'],
  );
  // The page is tried with both user agents before reaching for the export.
  assert.deepEqual(calls, [
    CHALLENGED_CALENDAR_URL,
    CHALLENGED_CALENDAR_URL,
    `${CHALLENGED_CALENDAR_URL}?ical=1`,
  ]);
});

test('a challenge that only the browser UA hits is retried with a plain client UA', async () => {
  const agents = [];
  const events = await calendarsSource.fetchEvents({
    env: { CALENDAR_DEFAULTS: 'off', CALENDAR_URLS: CHALLENGED_CALENDAR_URL },
    fetchImpl: async (url, init = {}) => {
      const ua = init.headers?.['user-agent'] || '';
      agents.push(ua);
      return /Mozilla/.test(ua) ? challengeResponse() : textResponse(CALENDAR_JSONLD_FIXTURE);
    },
    logger: { warn: () => {}, debug: () => {} },
  });

  assert.equal(agents.length, 2);
  assert.match(agents[0], /Mozilla/);
  assert.equal(events.length, 2);
});

test('a challenge served with a 200 is not read as a calendar with no events', async () => {
  const events = await calendarsSource.fetchEvents({
    env: { CALENDAR_DEFAULTS: 'off', CALENDAR_URLS: CHALLENGED_CALENDAR_URL },
    fetchImpl: async (url) =>
      url.includes('ical=1') ? textResponse(ICS_FIXTURE) : textResponse(BOT_CHALLENGE_HTML, 200),
    logger: { warn: () => {}, debug: () => {} },
  });

  assert.equal(events.length, 2);
});

test('an event page that merely mentions a bot wall is still read', async () => {
  const page = CALENDAR_JSONLD_FIXTURE.replace(
    'Plant natives with the parks crew.',
    'Wait just a moment while the crew sets up.',
  );
  const events = await calendarsSource.fetchEvents({
    env: { CALENDAR_DEFAULTS: 'off', CALENDAR_URLS: 'https://austinparks.org/events/' },
    fetchImpl: async () => textResponse(page),
    logger: { warn: () => {}, debug: () => {} },
  });

  assert.deepEqual(
    events.map((event) => event.title),
    ['Greenbelt Restoration Day', 'An Evening With Local Poets'],
  );
});

test('one blocked calendar does not stop the others', async () => {
  const events = await calendarsSource.fetchEvents({
    env: {
      CALENDAR_DEFAULTS: 'off',
      CALENDAR_URLS: 'https://austinparks.org/events/,https://www.wildflower.org/events/',
    },
    fetchImpl: async (url) =>
      url.includes('wildflower') ? challengeResponse() : textResponse(CALENDAR_JSONLD_FIXTURE),
    logger: { warn: () => {}, debug: () => {} },
  });

  assert.equal(events.length, 2);
});

test('an all-blocked run reports the block instead of a successful empty feed', async () => {
  await assert.rejects(
    calendarsSource.fetchEvents({
      env: {
        CALENDAR_DEFAULTS: 'off',
        CALENDAR_URLS: 'https://www.wildflower.org/events/,https://austinparks.org/events/',
      },
      fetchImpl: async () => challengeResponse(),
      logger: { warn: () => {}, debug: () => {} },
    }),
    /blocked by bot protection \(www\.wildflower\.org, austinparks\.org\)/,
  );
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

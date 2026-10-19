import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeCommunityEvent, filterEvents } from '../src/utils/events.js';

// The Firestore shape written by the ingestion service (see normalize.js).
const curatedDoc = {
  title: 'House Show at Mohawk',
  description: 'Three bands, one night.',
  category: 'Music/Indie',
  tags: ['house show'],
  neighborhood: 'Downtown',
  address: '912 Red River St, Austin, TX',
  startAt: { seconds: 1795226400, nanoseconds: 0 }, // 2026-11-21T02:00:00Z
  endAt: null,
  imageUrl: 'https://img.example/show.jpg',
  price: '$10',
  capacity: null,
  attendeeCount: 0,
  hostUid: 'gather:curated',
  hostName: 'Luma',
  origin: 'curated',
  source: 'luma',
  sourceLabel: 'Luma',
  externalId: 'evt-1@lu.ma',
  sourceUrl: 'https://lu.ma/abc123',
};

test('curated rows are normalized as read-only listings', () => {
  const event = normalizeCommunityEvent('curated_1', curatedDoc);

  assert.equal(event.source, 'curated');
  assert.equal(event.origin, 'curated');
  assert.equal(event.sourceId, 'luma');
  assert.equal(event.sourceLabel, 'Luma');
  assert.equal(event.externalId, 'evt-1@lu.ma');
  assert.equal(event.sourceUrl, 'https://lu.ma/abc123');
  assert.equal(event.url, 'https://lu.ma/abc123');
  assert.equal(event.attendeeCount, null);
  assert.equal(event.capacity, null);
  assert.equal(event.image, 'https://img.example/show.jpg');
  assert.equal(event.price, '$10');
});

test('curated label falls back to the source name', () => {
  const event = normalizeCommunityEvent('curated_2', {
    ...curatedDoc,
    sourceLabel: undefined,
    source: 'eventbrite',
  });
  assert.equal(event.sourceLabel, 'Eventbrite');
});

test('community posts keep RSVP counts and default to Free', () => {
  const event = normalizeCommunityEvent('community_1', {
    title: 'Riverside Potluck',
    description: 'Bring a dish.',
    category: 'Food & Drink',
    neighborhood: 'Riverside',
    address: '1200 E Riverside Dr',
    startAt: { seconds: 1795226400, nanoseconds: 0 },
    attendeeCount: 3,
    capacity: 20,
    hostUid: 'uid-1',
    hostName: 'Rio',
  });

  assert.equal(event.source, 'community');
  assert.equal(event.sourceLabel, '');
  assert.equal(event.price, 'Free');
  assert.equal(event.attendeeCount, 3);
  assert.equal(event.capacity, 20);
  assert.equal(event.url, '');
});

test('curated events participate in board filters like any other event', () => {
  const curated = normalizeCommunityEvent('curated_1', curatedDoc);
  const community = normalizeCommunityEvent('community_1', {
    title: 'Zine Swap',
    category: 'Pop-ups',
    neighborhood: 'East Austin',
    address: '2100 E Cesar Chavez St',
    startAt: { seconds: 1795226400, nanoseconds: 0 },
    attendeeCount: 0,
  });

  const now = new Date('2026-10-18T00:00:00Z');
  assert.equal(filterEvents([curated, community], { category: 'Music/Indie' }, now).length, 1);
  assert.equal(filterEvents([curated, community], { neighborhood: 'Downtown' }, now).length, 1);
  assert.equal(filterEvents([curated, community], { query: 'mohawk' }, now).length, 1);
});

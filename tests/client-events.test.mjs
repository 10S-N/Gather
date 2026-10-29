import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeCommunityEvent,
  filterEvents,
  collectTags,
  nextUpcomingEvent,
  parsePriceAmount,
  sortEvents,
  startsLater,
} from '../src/utils/events.js';

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
  assert.equal(filterEvents([curated, community], { neighborhoods: ['Downtown'] }, now).length, 1);
  assert.equal(filterEvents([curated, community], { query: 'mohawk' }, now).length, 1);
});

// Two upcoming events with different prices, tags, and dates.
const board = [
  normalizeCommunityEvent('paid', {
    title: 'Indie Night',
    category: 'Music/Indie',
    neighborhood: 'Downtown',
    address: '912 Red River St',
    price: '$15',
    tags: ['indie', 'livemusic'],
    startAt: { seconds: 1795132800, nanoseconds: 0 }, // 2026-11-20T00:00:00Z
    hostUid: 'uid-1',
  }),
  normalizeCommunityEvent('free', {
    title: 'Zine Swap',
    category: 'Pop-ups',
    neighborhood: 'East Austin',
    address: '2100 E Cesar Chavez St',
    price: 'Free',
    tags: ['zines', 'makers'],
    startAt: { seconds: 1795564800, nanoseconds: 0 }, // 2026-11-25T00:00:00Z
    hostUid: 'uid-1',
  }),
];

const boardNow = new Date('2026-10-18T00:00:00Z');

test('price filter splits free from paid and ignores unknown prices', () => {
  assert.deepEqual(
    filterEvents(board, { price: 'free' }, boardNow).map((event) => event.id),
    ['free'],
  );
  assert.deepEqual(
    filterEvents(board, { price: 'paid' }, boardNow).map((event) => event.id),
    ['paid'],
  );
  assert.equal(filterEvents(board, { price: 'all' }, boardNow).length, 2);

  // A curated listing with no stated price is not silently labelled free.
  const unknown = normalizeCommunityEvent('unknown', {
    title: 'Price TBA',
    category: 'Art',
    neighborhood: 'Downtown',
    startAt: { seconds: 1795132800, nanoseconds: 0 },
    origin: 'curated',
    source: 'do512',
    price: '',
  });
  assert.equal(parsePriceAmount(unknown.price), null);
  assert.equal(filterEvents([unknown], { price: 'free' }, boardNow).length, 0);
  assert.equal(filterEvents([unknown], { price: 'paid' }, boardNow).length, 0);
  assert.equal(filterEvents([unknown], { price: 'all' }, boardNow).length, 1);
});

test('price parsing reads ranges and falls back to null', () => {
  assert.equal(parsePriceAmount('Free'), 0);
  assert.equal(parsePriceAmount('$0'), 0);
  assert.equal(parsePriceAmount('$12'), 12);
  assert.equal(parsePriceAmount('$10 – $20'), 10);
  assert.equal(parsePriceAmount('See ticket'), null);
  assert.equal(parsePriceAmount(''), null);
  assert.equal(parsePriceAmount(null), null);
});

test('tag chips match any selected tag and ignore case', () => {
  assert.deepEqual(
    filterEvents(board, { tags: ['zines'] }, boardNow).map((event) => event.id),
    ['free'],
  );
  assert.equal(filterEvents(board, { tags: ['INDIE', 'zines'] }, boardNow).length, 2);
  assert.equal(filterEvents(board, { tags: ['nothing-here'] }, boardNow).length, 0);
});

test('custom date range is inclusive of both endpoints', () => {
  const range = { dateFrom: '2026-11-24', dateTo: '2026-11-26' };
  assert.deepEqual(
    filterEvents(board, range, boardNow).map((event) => event.id),
    ['free'],
  );
  assert.deepEqual(
    filterEvents(board, { dateFrom: '2026-11-24' }, boardNow).map((event) => event.id),
    ['free'],
  );
  assert.deepEqual(
    filterEvents(board, { dateTo: '2026-11-21' }, boardNow).map((event) => event.id),
    ['paid'],
  );
  // A preset and a custom range both narrow; the empty range is a no-op.
  assert.equal(filterEvents(board, { when: 'week', dateFrom: '', dateTo: '' }, boardNow).length, 0);
});

test('collectTags ranks the tags actually in use', () => {
  assert.deepEqual(
    collectTags([...board, { tags: ['zines'] }]),
    [
      { tag: 'zines', count: 2 },
      { tag: 'indie', count: 1 },
      { tag: 'livemusic', count: 1 },
      { tag: 'makers', count: 1 },
    ],
  );
});

// Three events across two neighborhoods, at different prices, with different
// RSVP counts and start times.
const sortable = [
  normalizeCommunityEvent('c', {
    title: 'Cheap and popular',
    category: 'Community',
    neighborhood: 'Riverside',
    price: 'Free',
    attendeeCount: 40,
    startAt: { seconds: 1795737600, nanoseconds: 0 }, // 2026-11-27
  }),
  normalizeCommunityEvent('b', {
    title: 'Mid price',
    category: 'Community',
    neighborhood: 'Hyde Park',
    price: '$20',
    attendeeCount: 2,
    startAt: { seconds: 1795305600, nanoseconds: 0 }, // 2026-11-22
  }),
  // A curated row: no price stated, and no attendee count either.
  normalizeCommunityEvent('a', {
    title: 'Soonest, no price stated',
    category: 'Community',
    neighborhood: 'Riverside',
    price: '',
    attendeeCount: null,
    origin: 'curated',
    source: 'do512',
    startAt: { seconds: 1795132800, nanoseconds: 0 }, // 2026-11-20
  }),
];

test('several neighborhoods can be selected at once', () => {
  assert.deepEqual(
    filterEvents(sortable, { neighborhoods: ['Riverside'] }, boardNow).map((event) => event.id),
    ['c', 'a'],
  );
  // Chips widen the browse: any picked neighborhood matches, so both Riverside
  // events and the Hyde Park one come back.
  assert.deepEqual(
    filterEvents(sortable, { neighborhoods: ['Riverside', 'Hyde Park'] }, boardNow).map(
      (event) => event.id,
    ),
    ['c', 'b', 'a'],
  );
  // No selection means every neighborhood.
  assert.equal(filterEvents(sortable, { neighborhoods: [] }, boardNow).length, 3);
  // A neighborhood with nothing in it returns nothing, not everything.
  assert.equal(filterEvents(sortable, { neighborhoods: ['Mueller'] }, boardNow).length, 0);
});

test('sort options order the board predictably', () => {
  const ids = (sort) => sortEvents(sortable, sort).map((event) => event.id);

  // Soonest is the default, and an unknown value falls back to it.
  assert.deepEqual(ids('soonest'), ['a', 'b', 'c']);
  assert.deepEqual(ids(), ['a', 'b', 'c']);
  assert.deepEqual(ids('nonsense'), ['a', 'b', 'c']);

  assert.deepEqual(ids('latest'), ['c', 'b', 'a']);
  // Free → $20 → unstated price last, never treated as free.
  assert.deepEqual(ids('cheapest'), ['c', 'b', 'a']);
  assert.deepEqual(ids('popular'), ['c', 'b', 'a']);
  // The curated row is still last on price even though it starts first.
  assert.equal(sortEvents(sortable, 'cheapest').at(-1).id, 'a');

  // Ties keep the soonest-first order rather than shuffling between renders.
  const tied = [
    { id: 'later', price: 'Free', attendeeCount: 5, startAt: new Date('2026-11-25T00:00:00Z') },
    { id: 'earlier', price: 'Free', attendeeCount: 5, startAt: new Date('2026-11-21T00:00:00Z') },
  ];
  assert.deepEqual(sortEvents(tied, 'popular').map((event) => event.id), ['earlier', 'later']);
  assert.deepEqual(sortEvents(tied, 'cheapest').map((event) => event.id), ['earlier', 'later']);
});

// "Next up" on the hero used to be the soonest start among everything still
// running, so a festival that opened the previous Saturday answered with a date
// six days in the past.
const nextUpNow = new Date('2026-10-29T21:00:00Z');

const festival = {
  id: 'festival',
  startAt: new Date('2026-10-24T16:00:00Z'),
  endAt: new Date('2026-10-31T23:00:00Z'), // still running
};
const tonight = {
  id: 'tonight',
  startAt: new Date('2026-10-29T23:00:00Z'),
  endAt: null,
};
const nextWeek = {
  id: 'next-week',
  startAt: new Date('2026-11-05T02:00:00Z'),
  endAt: null,
};

test('a run that started days ago is not what comes next', () => {
  assert.equal(startsLater(festival, nextUpNow), false);
  assert.equal(startsLater(tonight, nextUpNow), true);

  // The festival is still listed (it has not ended), yet "next up" is tonight.
  assert.equal(nextUpcomingEvent([festival, nextWeek, tonight], nextUpNow).id, 'tonight');
  assert.equal(nextUpcomingEvent([festival, nextWeek], nextUpNow).id, 'next-week');
});

test('when everything has already started, the soonest ongoing run answers', () => {
  const ongoing = { ...festival, startAt: new Date('2026-10-29T13:00:00Z') };
  assert.equal(nextUpcomingEvent([ongoing], nextUpNow).id, 'festival');
  // And nothing at all is still null rather than throwing.
  assert.equal(nextUpcomingEvent([], nextUpNow), null);
});

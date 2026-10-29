// Ranking rules for the "For you" feed: matches first, then everything else,
// with past events dropped and a reason line only where there is a real match.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hasPicks,
  normalizePicks,
  rankRecommendations,
  scoreEvent,
} from '../src/utils/recommend.js';

const now = new Date('2026-11-01T12:00:00Z');

const event = (id, category, neighborhood, startAt) => ({
  id,
  title: `Event ${id}`,
  category,
  neighborhood,
  startAt: new Date(startAt),
});

test('matches come first, strongest first, and the rest of the board follows', () => {
  const events = [
    event('art-zilker', 'Art', 'Zilker', '2026-11-05T20:00:00Z'),
    event('music-zilker', 'Music/Indie', 'Zilker', '2026-11-09T20:00:00Z'),
    event('art-east', 'Art', 'East Austin', '2026-11-03T20:00:00Z'),
    event('music-east', 'Music/Indie', 'East Austin', '2026-11-08T20:00:00Z'),
  ];

  const result = rankRecommendations(
    events,
    { categories: ['Music/Indie'], neighborhoods: ['East Austin'] },
    { now },
  );

  assert.equal(result.personalized, true);
  assert.equal(result.matchCount, 3);
  assert.equal(result.total, 4);

  // Both picks hit (5) beats category only (3) beats neighborhood only (2);
  // the unmatched art show sits in date order at the end.
  assert.deepEqual(
    result.items.map((item) => item.event.id),
    ['music-east', 'music-zilker', 'art-east', 'art-zilker'],
  );

  assert.deepEqual(
    result.items.map((item) => item.reason),
    [
      'Your picks: Music/Indie · East Austin',
      'Because you picked Music/Indie',
      'In East Austin — one of your neighborhoods',
      '',
    ],
  );
});

test('equal-strength matches are ordered soonest first', () => {
  const events = [
    event('later', 'Art', 'Zilker', '2026-11-20T20:00:00Z'),
    event('sooner', 'Art', 'Zilker', '2026-11-04T20:00:00Z'),
  ];

  const result = rankRecommendations(events, { categories: ['Art'] }, { now });
  assert.deepEqual(
    result.items.map((item) => item.event.id),
    ['sooner', 'later'],
  );
});

test('past events are dropped unless asked for', () => {
  const events = [
    event('past', 'Art', 'Zilker', '2026-11-01T02:00:00Z'), // ended before `now`
    event('future', 'Art', 'Zilker', '2026-11-06T02:00:00Z'),
  ];

  const upcoming = rankRecommendations(events, { categories: ['Art'] }, { now });
  assert.deepEqual(
    upcoming.items.map((item) => item.event.id),
    ['future'],
  );
  assert.equal(upcoming.total, 1);

  const all = rankRecommendations(events, { categories: ['Art'] }, { now, includePast: true });
  assert.equal(all.total, 2);
});

test('no picks means the whole board, soonest first, with no reasons', () => {
  const events = [
    event('b', 'Music/Indie', 'Hyde Park', '2026-11-12T20:00:00Z'),
    event('a', 'Art', 'Zilker', '2026-11-02T20:00:00Z'),
  ];

  const result = rankRecommendations(events, {}, { now });
  assert.equal(result.personalized, false);
  assert.equal(result.matchCount, 0);
  assert.deepEqual(
    result.items.map((item) => item.event.id),
    ['a', 'b'],
  );
  assert.ok(result.items.every((item) => item.reason === ''));
});

test('picks are normalized: duplicates, blanks, and junk are ignored', () => {
  assert.deepEqual(
    normalizePicks({
      categories: ['Art', 'Art', '  ', null, 7],
      neighborhoods: ['Zilker', 'Zilker'],
    }),
    { categories: ['Art'], neighborhoods: ['Zilker'] },
  );
  assert.deepEqual(normalizePicks(null), { categories: [], neighborhoods: [] });
  assert.equal(hasPicks({ categories: [], neighborhoods: ['Zilker'] }), true);
  assert.equal(hasPicks(null), false);

  const scored = scoreEvent(event('a', 'Art', 'Zilker', '2026-11-02T20:00:00Z'), {
    categories: ['Art', 'Art'],
    neighborhoods: [],
  });
  assert.equal(scored.score, 3);
  assert.equal(scored.reason, 'Because you picked Art');
});

test('an event with no start date is never classified as past and sorts last', () => {
  const events = [
    { id: 'undated', title: 'Undated', category: 'Art', neighborhood: 'Zilker', startAt: null },
    event('dated', 'Art', 'Zilker', '2026-11-04T20:00:00Z'),
  ];

  const result = rankRecommendations(events, {}, { now });
  assert.deepEqual(
    result.items.map((item) => item.event.id),
    ['dated', 'undated'],
  );
});

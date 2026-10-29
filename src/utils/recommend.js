// Recommendations for the "For you" feed. Pure on purpose: given the board and
// the user's picks, decide which events match, in what order, and why — no
// Firestore or React involved, so the ranking is testable on its own.
//
// Matches come first (that is the point of the page), ordered by how many of
// the user's picks an event hits and then by start time. Everything else
// follows in date order, so someone with narrow picks still gets a full feed
// instead of an empty page.

import { isPastEvent, sortByStart } from './events.js';

export const EMPTY_PICKS = { categories: [], neighborhoods: [] };

const CATEGORY_WEIGHT = 3;
const NEIGHBORHOOD_WEIGHT = 2;

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// Tolerates whatever is stored in Firestore: missing fields, duplicates, and
// values from a taxonomy that has since changed.
export function normalizePicks(input) {
  return {
    categories: uniqueStrings(input?.categories),
    neighborhoods: uniqueStrings(input?.neighborhoods),
  };
}

export function hasPicks(picks) {
  const { categories, neighborhoods } = normalizePicks(picks);
  return categories.length + neighborhoods.length > 0;
}

function matchReason(category, neighborhood) {
  if (category && neighborhood) return `Your picks: ${category} · ${neighborhood}`;
  if (category) return `Because you picked ${category}`;
  if (neighborhood) return `In ${neighborhood} — one of your neighborhoods`;
  return '';
}

// Why an event is being recommended, and how strongly. `reason` is the line the
// card shows; it is empty for events that are only filling out the feed.
export function scoreEvent(event, picks) {
  const { categories, neighborhoods } = normalizePicks(picks);
  const category = categories.find((name) => name === event?.category) || '';
  const neighborhood = neighborhoods.find((name) => name === event?.neighborhood) || '';
  const score =
    (category ? CATEGORY_WEIGHT : 0) + (neighborhood ? NEIGHBORHOOD_WEIGHT : 0);

  return {
    score,
    matched: score > 0,
    reason: matchReason(category, neighborhood),
  };
}

// Returns { personalized, matchCount, total, items } where each item is
// { event, score, matched, reason }. Past events are dropped by default —
// recommending something that already happened is worse than an empty slot.
export function rankRecommendations(
  events,
  picks,
  { now = new Date(), includePast = false } = {},
) {
  const normalized = normalizePicks(picks);
  const items = [];

  for (const event of events || []) {
    if (!includePast && isPastEvent(event, now)) continue;
    const { score, matched, reason } = scoreEvent(event, normalized);
    items.push({ event, score, matched, reason });
  }

  const matches = items
    .filter((item) => item.matched)
    .sort((a, b) => b.score - a.score || sortByStart(a.event, b.event));
  const rest = items.filter((item) => !item.matched).sort((a, b) => sortByStart(a.event, b.event));

  return {
    personalized: hasPicks(normalized),
    matchCount: matches.length,
    total: items.length,
    items: [...matches, ...rest],
  };
}

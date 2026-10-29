// Eventbrite ingestion adapter (REST API v3).
//
// Eventbrite is the easiest developer-friendly source of structured indie
// happenings, but it is *not* CORS-friendly, so this runs server-side (CLI,
// cron, or the serverless handler) with a private token — never in the browser.
//
// Config:
//   EVENTBRITE_API_KEY=...          # private token, required
//   EVENTBRITE_PLACES=101724577     # optional: discovery locality ids (Austin default)
//   EVENTBRITE_ORGANIZERS=123,456   # optional: read specific organizers instead
//   EVENTBRITE_CATEGORIES=111,108   # optional: override the category scope
//   EVENTBRITE_MAX_EVENTS=60        # optional: cap for one run
//
// Two ways to read the catalogue:
//   * discovery (default) — POST /v3/destination/search/ with a place id, which
//     is the same search that powers the public site. GET /v3/events/search/ is
//     retired (404 for every app created after 2019) and the docs still point at
//     it, so it is not used at all here.
//   * EVENTBRITE_ORGANIZERS — each organization's event list, a documented
//     endpoint that needs the org ids you care about.
//
// The token must be an Eventbrite *private* token (the long one from
// https://www.eventbrite.com/platform/api-keys). The short 20-character "public
// key" is for OAuth in the browser and is rejected with 403 by this API.

import { requestJson } from '../http.js';
import { splitList } from '../text.js';
import { AUSTIN_TIME_ZONE, zonedTimeToUtc } from '../time.js';

const API_ROOT = 'https://www.eventbriteapi.com/v3';
const DESTINATION_SEARCH = `${API_ROOT}/destination/search/`;
const DEFAULT_LOOKAHEAD_DAYS = 120;
const MAX_PAGES = 10;
const DEFAULT_MAX_EVENTS = 60;

// Eventbrite's own place id for the Austin locality (the object the site's
// location picker returns). Only used to scope discovery.
const AUSTIN_PLACE_ID = '101724577';
const DEFAULT_PLACES = [AUSTIN_PLACE_ID];

const DROP_STATUS = new Set(['canceled', 'cancelled', 'draft', 'ended']);

// Titles that are never a in-person local happening even when the listing says
// it has a venue row.
const VIRTUAL_TITLE =
  /\b(virtual|webinar|web ?cast|livestream|live ?stream|online (event|class|workshop|screening|talk))\b/i;

// Eventbrite category ids → labels we can feed to the category inference.
const CATEGORY_BY_ID = {
  101: 'Music',
  102: 'Film & Media',
  103: 'Performing & Visual Arts',
  104: 'Fashion',
  105: 'Health',
  106: 'Sports & Fitness',
  107: 'Travel & Outdoor',
  108: 'Food & Drink',
  109: 'Charity & Causes',
  110: 'Government',
  111: 'Community',
  112: 'Family & Education',
  113: 'Business',
  114: 'Other',
  199: 'Other',
};

// Discovery search uses Eventbrite's newer browse taxonomy, where the category
// arrives as a display label ("Community & Culture") and the numeric ids no
// longer match the v3 table above (113 is Community & Culture there, Business in
// /v3/events). These labels are off the board's scope; everything else is local
// culture and stays.
const EXCLUDED_CATEGORY_LABELS = new Set(['business & professional', 'fashion', 'auto, boat & air']);

// EVENTBRITE_API_KEY is the documented name; only set EVENTBRITE_API_TOKEN in
// older .env.local files (previously named bucket). The former wins.
function tokenFor(env = {}) {
  return String(env.EVENTBRITE_API_KEY || env.EVENTBRITE_API_TOKEN || '').trim();
}

function maxEventsFor(env = {}) {
  const value = Number.parseInt(String(env.EVENTBRITE_MAX_EVENTS ?? ''), 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_EVENTS;
}

function placesFor(env = {}) {
  const places = splitList(env.EVENTBRITE_PLACES);
  return places.length ? places : DEFAULT_PLACES;
}

// Empty scope means "everything Eventbrite returns for the place, minus the
// excluded labels". "all" keeps even those.
function categoriesFor(env = {}) {
  const configured = splitList(env.EVENTBRITE_CATEGORIES);
  if (configured.some((value) => /^all$/i.test(value))) return { mode: 'all', labels: [] };
  if (configured.length) {
    return { mode: 'only', labels: configured.map((value) => value.toLowerCase()) };
  }
  return { mode: 'default', labels: [] };
}

function priceOf(ev) {
  if (ev?.is_free) return 'Free';
  const min = ev?.ticket_availability?.minimum_ticket_price?.major_value;
  if (min == null || min === '') return '';
  const value = Number(min);
  if (!Number.isFinite(value)) return '';
  if (value <= 0) return 'Free';
  return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

function isUsable(ev) {
  if (!ev?.id) return false;
  const status = String(ev.status || '').toLowerCase();
  if (status && DROP_STATUS.has(status)) return false;
  if (ev.online_event) return false; // hyper-local board: no virtual events
  if (!ev.name?.text && !ev.name?.html) return false;
  if (!ev.start?.utc && !ev.start?.local) return false;
  return true;
}

// The discovery payload names its category instead of sending an id, and the
// label is what our taxonomy understands.
function categoryFromTags(tags) {
  const categoryTag = (tags || []).find((tag) => /^EventbriteCategory\//.test(tag?.tag || ''));
  const id = categoryTag?.tag?.split('/')[1] || '';
  return { id, label: categoryTag?.display_name || '' };
}

function categoryAllowed(label, id, scope) {
  const name = String(label || '').trim().toLowerCase();
  if (scope.mode === 'only') {
    return scope.labels.includes(name) || scope.labels.includes(id);
  }
  if (scope.mode === 'all') return true;
  return !EXCLUDED_CATEGORY_LABELS.has(name);
}

// Destination-search results carry a tag list rather than `category_id`, and
// no price at all, so they get their own mapper.
export function mapEventbriteSearchResult(ev) {
  const locations = Array.isArray(ev.locations) ? ev.locations : [];
  const locality = locations.find((entry) => entry?.type === 'locality');
  const neighbourhood = locations.find((entry) => entry?.type === 'neighbourhood');
  const { id: categoryId, label: category } = categoryFromTags(ev.tags);

  return {
    externalId: String(ev.id || ev.eventbrite_event_id || ''),
    title: ev.name || '',
    description: ev.full_description || ev.summary || '',
    startAt: searchInstant(ev, 'start_date', 'start_time'),
    endAt: searchInstant(ev, 'end_date', 'end_time'),
    url: ev.url || '',
    imageUrl: '',
    venueName: '',
    // The search payload has no street address, only the place hierarchy. A
    // neighbourhood is honest enough to seed inference; inventing a street
    // number would not be.
    address: [neighbourhood?.name, 'Austin, TX'].filter(Boolean).join(', '),
    city: locality?.name || '',
    lat: null,
    lng: null,
    price: '',
    externalCategory: category,
    tags: (ev.tags || []).map((tag) => tag?.display_name || '').filter(Boolean),
    categoryId,
    isCancelled: Boolean(ev.is_cancelled),
    isOnline: Boolean(ev.is_online_event),
  };
}

// `start_date: '2026-11-14'` + `start_time: '22:00'` are wall-clock values in the
// listing's own timezone, not instants.
function searchInstant(ev, dateKey, timeKey) {
  const day = String(ev?.[dateKey] || '').trim();
  if (!day) return null;
  const [year, month, date] = day.split('-').map(Number);
  if (![year, month, date].every(Number.isFinite)) return null;

  const time = String(ev?.[timeKey] || '').trim();
  const [hour = 0, minute = 0] = time ? time.split(':').map(Number) : [];
  if (![hour, minute].every(Number.isFinite)) return null;

  try {
    const instant = zonedTimeToUtc(
      { year, month, day: date, hour, minute },
      ev.timezone || AUSTIN_TIME_ZONE,
    );
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
  } catch {
    // Unknown IANA zone on the listing: fall back to an unqualified string the
    // shared normalizer interprets as Austin time.
    return `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
}

export function mapEventbriteEvent(ev) {
  const venue = ev._embedded?.venues?.[0];
  const addressParts = [
    venue?.address?.address_1,
    venue?.address?.city,
    venue?.address?.region,
    venue?.address?.postal_code,
  ].filter(Boolean);

  return {
    externalId: String(ev.id),
    title: ev.name?.text || ev.name?.html || '',
    description: ev.description?.text || ev.description?.html || ev.summary || '',
    startAt: ev.start?.utc || ev.start?.local || '',
    endAt: ev.end?.utc || ev.end?.local || null,
    url: ev.url || '',
    imageUrl: ev.logo?.original?.url || ev.logo?.url || '',
    venueName: venue?.name || '',
    address: addressParts.join(', '),
    city: venue?.address?.city || '',
    lat: venue?.latitude ? Number(venue.latitude) : null,
    lng: venue?.longitude ? Number(venue.longitude) : null,
    price: priceOf(ev),
    externalCategory: ev._embedded?.category?.name || CATEGORY_BY_ID[ev.category_id] || '',
    tags: Array.isArray(ev.tags)
      ? ev.tags.map((tag) => tag?.name || tag?.display_name || '').filter(Boolean)
      : [],
  };
}

export function organizerUrls(env, now) {
  const rangeStart = now.toISOString();
  const rangeEnd = new Date(now.getTime() + DEFAULT_LOOKAHEAD_DAYS * 86_400_000).toISOString();
  return splitList(env.EVENTBRITE_ORGANIZERS).map(
    (id) =>
      `${API_ROOT}/organizations/${encodeURIComponent(id)}/events/?` +
      new URLSearchParams({
        status: 'live',
        order_by: 'start_asc',
        time_filter: 'current_future',
        expand: 'venue,category',
      }).toString() +
      `&start_date.range_start=${encodeURIComponent(rangeStart)}` +
      `&start_date.range_end=${encodeURIComponent(rangeEnd)}`,
  );
}

async function fetchOrganizerPage(url, token, { fetchImpl } = {}) {
  const page = await requestJson(url, {
    fetchImpl,
    headers: { authorization: `Bearer ${token}` },
  });
  const events = Array.isArray(page?.events) ? page.events : [];
  return {
    events,
    continuation:
      page?.pagination?.has_more_items && page?.pagination?.continuation
        ? String(page.pagination.continuation)
        : null,
  };
}

async function fetchSearchPage({ places, page }, token, { fetchImpl } = {}) {
  const body = await requestJson(DESTINATION_SEARCH, {
    fetchImpl,
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ event_search: { q: '', dates: 'current_future', places, page } }),
  });
  return body;
}

function explainsStatus(err, mode) {
  if (err?.status === 401) {
    return new Error(
      'Eventbrite rejected the token (401). EVENTBRITE_API_KEY must be a private token, not the public OAuth key.',
      { cause: err },
    );
  }
  if (err?.status === 403) {
    return new Error(
      'Eventbrite denied access (403). That is a public key, not a private API token — create one at https://www.eventbrite.com/platform/api-keys.',
      { cause: err },
    );
  }
  if (err?.status === 429) {
    return new Error('Eventbrite rate limit reached (429). Wait a minute, then re-run the sync.', {
      cause: err,
    });
  }
  if (err?.status === 404 || err?.status === 405) {
    return new Error(
      mode === 'search'
        ? 'Eventbrite discovery search is unavailable for this app (404/405). Set EVENTBRITE_ORGANIZERS to the organizer ids you follow.'
        : 'Eventbrite returned 404 for that organizer. Check the id in EVENTBRITE_ORGANIZERS.',
      { cause: err },
    );
  }
  return err;
}

// Discovery mode: read a place's public listings page by page until the run is
// full. Category scoping happens here rather than in the request because the
// destination endpoint does not document a category filter.
async function fetchDiscovery(env, token, { fetchImpl, maxEvents, logger }) {
  const places = placesFor(env);
  const categoryScope = categoriesFor(env);
  const seen = new Set();
  const raw = [];

  for (let page = 1; page <= MAX_PAGES && raw.length < maxEvents; page += 1) {
    let body;
    try {
      body = await fetchSearchPage({ places, page }, token, { fetchImpl });
    } catch (err) {
      throw explainsStatus(err, 'search');
    }

    const results = Array.isArray(body?.events?.results) ? body.events.results : [];
    if (!results.length) break;

    for (const ev of results) {
      if (raw.length >= maxEvents) break;
      if (ev?.is_cancelled || ev?.is_online_event) continue;

      const mapped = mapEventbriteSearchResult(ev);
      if (!mapped.externalId) continue;
      if (!mapped.startAt) continue;
      // The place id already scopes the query, but a protected/relocated listing
      // can still come back with another city, so keep the guard.
      if (mapped.city && !/austin/i.test(mapped.city)) continue;
      if (!categoryAllowed(mapped.externalCategory, mapped.categoryId, categoryScope)) continue;
      if (VIRTUAL_TITLE.test(mapped.title)) continue;
      if (seen.has(mapped.externalId)) continue;

      seen.add(mapped.externalId);
      raw.push(mapped);
    }

    const count = Number(body?.events?.pagination?.object_count || 0);
    if (count && page * 10 >= count) break;
    logger?.debug?.(`[eventbrite] discovery page ${page} · ${raw.length}/${maxEvents}`);
  }

  return raw;
}

// Organizer mode: the documented per-organization event list.
async function fetchOrganizers(env, token, { fetchImpl, maxEvents, logger, now }) {
  const seen = new Set();
  const raw = [];

  for (const initialUrl of organizerUrls(env, now)) {
    let url = initialUrl;
    for (let page = 0; page < 3 && url && raw.length < maxEvents; page += 1) {
      let result;
      try {
        result = await fetchOrganizerPage(url, token, { fetchImpl });
      } catch (err) {
        throw explainsStatus(err, 'organizers');
      }

      for (const ev of result.events) {
        if (raw.length >= maxEvents) break;
        if (!isUsable(ev)) continue;

        const mapped = mapEventbriteEvent(ev);
        if (mapped.city && !/austin/i.test(mapped.city)) continue;
        if (VIRTUAL_TITLE.test(mapped.title)) continue;
        if (seen.has(mapped.externalId)) continue;

        seen.add(mapped.externalId);
        raw.push(mapped);
      }

      if (!result.continuation || raw.length >= maxEvents) break;
      const next = new URL(initialUrl);
      next.searchParams.set('continuation', result.continuation);
      url = next.toString();
      logger?.debug?.(`[eventbrite] organizer page ${page + 2}`);
    }
  }

  return raw;
}

export const eventbriteSource = {
  id: 'eventbrite',
  label: 'Eventbrite',
  kind: 'api',
  envVars: [
    'EVENTBRITE_API_KEY',
    'EVENTBRITE_PLACES',
    'EVENTBRITE_ORGANIZERS',
    'EVENTBRITE_CATEGORIES',
    'EVENTBRITE_MAX_EVENTS',
  ],
  docsUrl: 'https://www.eventbrite.com/platform/api-keys',
  isConfigured: (env = {}) => Boolean(tokenFor(env)),

  async fetchEvents({ env = {}, fetchImpl, now = new Date(), logger = console } = {}) {
    const token = tokenFor(env);
    if (!token) throw new Error('EVENTBRITE_API_KEY is not set');

    const maxEvents = maxEventsFor(env);
    const options = { fetchImpl, maxEvents, logger, now };
    const organizers = splitList(env.EVENTBRITE_ORGANIZERS);

    return organizers.length
      ? fetchOrganizers(env, token, options)
      : fetchDiscovery(env, token, options);
  },
};

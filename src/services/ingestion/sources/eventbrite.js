// Eventbrite ingestion adapter.
//
// Eventbrite is the easiest developer-friendly source of structured indie
// happenings, but it is *not* CORS-friendly, so this normally runs server-side
// (CLI, cron, or the serverless handler) with a private token. The browser run
// on /admin/sync works only because `npm run dev` proxies the request through
// /__ingest (see vite.config.js).
//
// Config:
//   EVENTBRITE_API_KEY=...          # private token, required
//   EVENTBRITE_ORGANIZERS=123,456   # optional: pull specific indie organizers
//   EVENTBRITE_CATEGORIES=101,111   # optional: override the Austin defaults
//   EVENTBRITE_MAX_EVENTS=20        # optional: cap per run (1-50)
//
// EVENTBRITE_API_TOKEN is still accepted as an alias for older .env files.
//
// Two fetch paths:
//   * With EVENTBRITE_ORGANIZERS we read each organization's event list, which
//     is the reliable path on new apps.
//   * Without it we fall back to the public search endpoint scoped to Austin.
//     Eventbrite retired public event search for new apps; a 404/403 here means
//     your key cannot use it, and the fix is to list organizers instead.

import { requestJson } from '../http.js';
import { splitList } from '../text.js';

const API_ROOT = 'https://www.eventbriteapi.com/v3';

// Austin, TX. The search endpoint takes either a free-text location or a
// lat/lng pair; the address form is the one available on every app generation.
const AUSTIN = {
  address: 'Austin, TX',
  within: '25mi',
};

// Rough 30-mile box around downtown. Used to reject a venue that reports a
// different city but still leaks into an organizer's list.
const AUSTIN_BOUNDS = {
  minLat: 30.02,
  maxLat: 30.58,
  minLng: -98.08,
  maxLng: -97.5,
};

const DEFAULT_LOOKAHEAD_DAYS = 120;
const DEFAULT_MAX_EVENTS = 20;
const HARD_MAX_EVENTS = 50;
const PAGE_SIZE = 50;
const MAX_PAGES = 3;

const DROP_STATUS = new Set(['canceled', 'cancelled', 'draft', 'ended', 'deleted']);

// Community, indie music, arts, food, and social. 107 (Travel & Outdoor) and
// 112 (Family & Education) round those out without pulling in business summits
// or sports. Override with EVENTBRITE_CATEGORIES, or set it to `all`.
const DEFAULT_CATEGORY_IDS = ['101', '103', '107', '108', '111', '112'];

// Virtual-only listings that would otherwise pass the venue filter (many are
// tagged with a city but are webinars). Kept narrow so an in-person event that
// merely mentions "online tickets" is not dropped.
const VIRTUAL_ONLY =
  /\b(webinar|webcast|livestream|live[- ]stream|virtual (?:event|workshop|class|conference|summit|meetup)|online[- ]only|zoom (?:call|meeting|link))\b/i;

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

function priceOf(ev) {
  if (ev?.is_free) return 'Free';
  const min = ev?.ticket_availability?.minimum_ticket_price?.major_value;
  if (min == null || min === '') return '';
  const value = Number(min);
  if (!Number.isFinite(value)) return '';
  if (value <= 0) return 'Free';
  return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

function venueOf(ev) {
  return ev?._embedded?.venues?.[0] || null;
}

function isAustinVenue(ev) {
  const venue = venueOf(ev);
  const city = venue?.address?.city;
  if (city && !/austin/i.test(String(city))) return false;

  const lat = Number(venue?.latitude);
  const lng = Number(venue?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return (
      lat >= AUSTIN_BOUNDS.minLat &&
      lat <= AUSTIN_BOUNDS.maxLat &&
      lng >= AUSTIN_BOUNDS.minLng &&
      lng <= AUSTIN_BOUNDS.maxLng
    );
  }

  // No venue details at all: keep it, the search was Austin-scoped. Organizer
  // feeds occasionally omit _embedded.venues even when expand=venue is set.
  return true;
}

function isVirtualOnly(ev) {
  const title = ev?.name?.text || ev?.name?.html || '';
  const summary = ev?.summary || '';
  return VIRTUAL_ONLY.test(`${title} ${summary}`);
}

function isUsable(ev) {
  if (!ev?.id) return false;
  const status = String(ev.status || '').toLowerCase();
  if (status && DROP_STATUS.has(status)) return false;
  if (ev.online_event) return false; // hyper-local board: no virtual events
  if (!ev.name?.text && !ev.name?.html) return false;
  if (!ev.start?.utc && !ev.start?.local) return false;
  if (isVirtualOnly(ev)) return false;
  return Boolean(isAustinVenue(ev));
}

export function mapEventbriteEvent(ev) {
  const venue = venueOf(ev);
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

function maxEventsFrom(env) {
  const parsed = Number.parseInt(env.EVENTBRITE_MAX_EVENTS ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_EVENTS;
  return Math.min(parsed, HARD_MAX_EVENTS);
}

function categoryIdsFrom(env) {
  const configured = splitList(env.EVENTBRITE_CATEGORIES);
  if (!configured.length) return DEFAULT_CATEGORY_IDS;
  if (configured.some((value) => /^(all|\*)$/i.test(value))) return [];
  return configured;
}

function buildUrls(env, now, maxEvents) {
  const organizers = splitList(env.EVENTBRITE_ORGANIZERS);
  const rangeStart = now.toISOString();
  const rangeEnd = new Date(now.getTime() + DEFAULT_LOOKAHEAD_DAYS * 86_400_000).toISOString();
  const pageSize = String(Math.min(PAGE_SIZE, Math.max(maxEvents, 10)));

  if (organizers.length) {
    return organizers.map(
      (id) =>
        `${API_ROOT}/organizations/${encodeURIComponent(id)}/events/?` +
        new URLSearchParams({
          status: 'live',
          order_by: 'start_asc',
          time_filter: 'current_future',
          expand: 'venue,category',
          page_size: pageSize,
          'start_date.range_start': rangeStart,
          'start_date.range_end': rangeEnd,
        }).toString(),
    );
  }

  const params = new URLSearchParams({
    'location.address': AUSTIN.address,
    'location.within': AUSTIN.within,
    'start_date.range_start': rangeStart,
    'start_date.range_end': rangeEnd,
    sort: 'date',
    page_size: pageSize,
    expand: 'venue,category',
  });
  const categories = categoryIdsFrom(env);
  if (categories.length) params.set('categories', categories.join(','));

  return [`${API_ROOT}/events/search/?${params.toString()}`];
}

async function fetchPage(url, apiKey, { fetchImpl } = {}) {
  const page = await requestJson(url, {
    fetchImpl,
    headers: { authorization: `Bearer ${apiKey}` },
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

function failureMessage(err, url) {
  const status = err?.status;
  if (status === 401) {
    return 'Eventbrite rejected the token (401). Check EVENTBRITE_API_KEY — use the private token from Account Settings → Developer Links → API Keys.';
  }
  if (status === 403) {
    return 'Eventbrite denied access (403). The key may lack the scopes this app needs; try setting EVENTBRITE_ORGANIZERS instead of public search.';
  }
  if (status === 429) {
    return 'Eventbrite rate limit reached (429). Wait a minute and retry, lower EVENTBRITE_MAX_EVENTS, or set EVENTBRITE_ORGANIZERS to fetch fewer pages.';
  }
  if (status === 404 && /\/events\/search\//.test(String(url))) {
    return 'Eventbrite public event search returned 404. Eventbrite retired that endpoint for new apps — set EVENTBRITE_ORGANIZERS to the Austin indie organizers you follow, then run again.';
  }
  if (status >= 500) {
    return `Eventbrite had a server error (${status}). The run can be retried safely; nothing was written for this source.`;
  }
  return `Eventbrite request failed: ${err?.message || err}`;
}

export const eventbriteSource = {
  id: 'eventbrite',
  label: 'Eventbrite',
  kind: 'api',
  envVars: ['EVENTBRITE_API_KEY', 'EVENTBRITE_ORGANIZERS', 'EVENTBRITE_CATEGORIES'],
  docsUrl: 'https://www.eventbrite.com/help/en-us/articles/849962/generate-an-api-key/',
  isConfigured: (env = {}) =>
    Boolean(String(env.EVENTBRITE_API_KEY || env.EVENTBRITE_API_TOKEN || '').trim()),

  async fetchEvents({ env = {}, fetchImpl, now = new Date(), logger = console } = {}) {
    const apiKey = String(env.EVENTBRITE_API_KEY || env.EVENTBRITE_API_TOKEN || '').trim();
    if (!apiKey) {
      throw new Error(
        'Eventbrite is not configured. Set EVENTBRITE_API_KEY (or VITE_EVENTBRITE_API_KEY for browser runs).',
      );
    }

    const maxEvents = maxEventsFrom(env);
    const urls = buildUrls(env, now, maxEvents);
    const seen = new Set();
    const raw = [];
    const failures = [];

    for (const initialUrl of urls) {
      let url = initialUrl;
      for (let page = 0; page < MAX_PAGES && url && raw.length < maxEvents; page += 1) {
        let result;
        try {
          result = await fetchPage(url, apiKey, { fetchImpl });
        } catch (err) {
          // Auth, permission, rate-limit, and retired-endpoint failures apply to
          // the whole source, so stop before hammering every organizer.
          const isSearch = /\/events\/search\//.test(url);
          const fatal = [401, 403, 429].includes(err?.status) || (err?.status === 404 && isSearch);
          if (fatal) {
            throw new Error(failureMessage(err, url), { cause: err });
          }
          // One bad organizer must not sink the whole source: keep what the
          // other feeds returned and surface the first real failure.
          failures.push({ error: err, url });
          logger?.warn?.(`[eventbrite] ${failureMessage(err, url)}`);
          break;
        }

        // Filter the *raw* Eventbrite objects first (they carry status/online
        // flags), then map into our canonical shape.
        for (const ev of result.events) {
          if (!isUsable(ev)) continue;
          const externalId = String(ev.id);
          if (seen.has(externalId)) continue;
          seen.add(externalId);
          raw.push(mapEventbriteEvent(ev));
          if (raw.length >= maxEvents) break;
        }

        if (!result.continuation || raw.length >= maxEvents) break;
        const base = new URL(initialUrl);
        base.searchParams.set('continuation', result.continuation);
        url = base.toString();
        logger?.debug?.(`[eventbrite] fetched page ${page + 2}`);
      }
    }

    if (!raw.length && failures.length) {
      const [first] = failures;
      throw new Error(failureMessage(first.error, first.url), { cause: first.error });
    }

    if (raw.length >= maxEvents) {
      logger?.info?.(`[eventbrite] capped at ${maxEvents} events for this run`);
    }

    return raw;
  },
};

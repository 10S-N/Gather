// Eventbrite ingestion adapter.
//
// Eventbrite is the easiest developer-friendly source of structured indie
// happenings, but it is *not* CORS-friendly, so this runs server-side (CLI,
// cron, or the serverless handler) with a private token — never in the browser.
//
// Config:
//   EVENTBRITE_API_TOKEN=...        # private token, required
//   EVENTBRITE_ORGANIZERS=123,456   # optional: pull specific indie organizers
//   EVENTBRITE_CATEGORIES=111,108   # optional: extra category filter
//
// With EVENTBRITE_ORGANIZERS set we read each organization's event list (a
// stable, documented endpoint). Without it we fall back to the public search
// endpoint scoped to Austin.

import { requestJson } from '../http.js';
import { splitList } from '../text.js';

const API_ROOT = 'https://www.eventbriteapi.com/v3';
const SEARCH_RADIUS = '25mi';
const DEFAULT_LOOKAHEAD_DAYS = 120;
const MAX_PAGES = 2;

const DROP_STATUS = new Set(['canceled', 'cancelled', 'draft', 'ended']);

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

function isAustin(city) {
  if (!city) return true; // city missing: keep, the search was Austin-scoped
  return /austin/i.test(String(city));
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

function buildUrls(env, now) {
  const organizers = splitList(env.EVENTBRITE_ORGANIZERS);
  const categories = splitList(env.EVENTBRITE_CATEGORIES);
  const rangeStart = now.toISOString();
  const rangeEnd = new Date(now.getTime() + DEFAULT_LOOKAHEAD_DAYS * 86_400_000).toISOString();

  if (organizers.length) {
    return organizers.map(
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

  const params = new URLSearchParams({
    'location.address': 'Austin, TX',
    'location.within': SEARCH_RADIUS,
    'start_date.range_start': rangeStart,
    'start_date.range_end': rangeEnd,
    sort: 'date',
    page_size: '50',
    expand: 'venue,category',
  });
  if (categories.length) params.set('categories', categories.join(','));

  return [`${API_ROOT}/events/search/?${params.toString()}`];
}

async function fetchPage(url, token, { fetchImpl } = {}) {
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

export const eventbriteSource = {
  id: 'eventbrite',
  label: 'Eventbrite',
  kind: 'api',
  envVars: ['EVENTBRITE_API_TOKEN', 'EVENTBRITE_ORGANIZERS', 'EVENTBRITE_CATEGORIES'],
  docsUrl: 'https://www.eventbrite.com/platform/api',
  isConfigured: (env = {}) => Boolean(env.EVENTBRITE_API_TOKEN),

  async fetchEvents({ env = {}, fetchImpl, now = new Date(), logger = console } = {}) {
    const token = env.EVENTBRITE_API_TOKEN;
    if (!token) throw new Error('EVENTBRITE_API_TOKEN is not set');

    const urls = buildUrls(env, now);
    const raw = [];

    for (const initialUrl of urls) {
      let url = initialUrl;
      for (let page = 0; page < MAX_PAGES && url; page += 1) {
        let result;
        try {
          result = await fetchPage(url, token, { fetchImpl });
        } catch (err) {
          if (err?.status === 401) {
            throw new Error('Eventbrite rejected the token (401). Check EVENTBRITE_API_TOKEN.', {
              cause: err,
            });
          }
          if (err?.status === 403) {
            throw new Error(
              'Eventbrite denied access (403). The token may lack events/search scope; try setting EVENTBRITE_ORGANIZERS instead.',
              { cause: err },
            );
          }
          if (err?.status === 404 && /search/.test(url)) {
            throw new Error(
              'Eventbrite search endpoint returned 404. Public event search is limited on new apps — set EVENTBRITE_ORGANIZERS to the indie organizers you follow.',
              { cause: err },
            );
          }
          throw err;
        }

        // Filter the *raw* Eventbrite objects first (they carry status/online
        // flags), then map into our canonical shape.
        raw.push(...result.events.filter(isUsable).map(mapEventbriteEvent).filter((e) => isAustin(e.city)));

        if (!result.continuation) break;
        const base = new URL(initialUrl);
        base.searchParams.set('continuation', result.continuation);
        url = base.toString();
        logger?.debug?.(`[eventbrite] fetched page ${page + 2}`);
      }
    }

    return raw;
  },
};


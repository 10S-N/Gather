// Community-calendar adapter: schema.org JSON-LD + iCalendar, no credentials.
//
// The events this board actually needs are the ones the ticketing feeds miss —
// park cleanups, civic meetings, library talks, neighborhood festivals, small
// nonprofit fundraisers. Those listings live on small Austin calendars that
// have no API, but nearly all of them run on a plugin that emits one of two
// machine-readable formats:
//
//   * schema.org `Event` objects in a <script type="application/ld+json"> block
//     (The Events Calendar, Yoast/Rank Math, Squarespace, most WordPress sites)
//   * an iCalendar export at `?ical=1` (The Events Calendar, Google Calendar)
//
// So adding a calendar here is a URL, not a scraper. The built-in list is the
// curated set verified against live markup; CALENDAR_URLS appends more.
//
// Config:
//   CALENDAR_URLS=https://example.org/events/,https://another.org/events/?ical=1
//   CALENDAR_DEFAULTS=off     # skip the built-in Austin calendars

import { parseIcs } from '../ics.js';
import { HttpError, looksLikeBotWall, requestText } from '../http.js';
import { parseIcsDate } from '../time.js';
import { decodeEntities, splitList, stableHash, stripHtml } from '../text.js';

// Everything here is Austin, and the board is Austin-only, so listings that
// name a different city are dropped rather than mapped onto a neighborhood.
const LOCAL_CITY = /austin/i;

// Every seed below was re-checked against live markup in Oct 2026; the counts
// are what the adapter actually parsed, not what the calendar advertises.

// 19 upcoming civic/nonprofit events over iCal.
const AUSTIN_COMMON = 'https://theaustincommon.com/events/?ical=1';
// 14 volunteer/park-stewardship listings as JSON-LD.
const AUSTIN_PARKS = 'https://austinparks.org/events/';
// ~10 food-access listings: farmers markets, cooking and garden classes.
const SUSTAINABLE_FOOD_CENTER = 'https://www.sustainablefoodcenter.org/events';
// ~10 native-plant classes, plant sales, and garden talks. Read from the
// iCalendar export rather than the page: wildflower.org sits behind Cloudflare,
// which answers datacenter IPs (the GitHub runner) with a "Just a moment..."
// challenge instead of the HTML. The export is the same listings in the format
// the challenge is not guarding.
const WILDFLOWER_CENTER = 'https://www.wildflower.org/events/?ical=1';
// ~15 upcoming community programs at the Dell JCC (all ages, mostly free).
const SHALOM_AUSTIN = 'https://www.shalomaustin.org/events';
// ~3 free youth writing workshops at library branches and rec centers.
const AUSTIN_BAT_CAVE = 'https://www.austinbatcave.org/events';

// Checked and deliberately left out, so nobody has to re-audit them:
//   TreeFolks (treefolks.org/events) — every startDate carries its UTC offset
//     twice (a 9am nursery workday ships as 03:00-06:00), so listings would
//     appear 5-6 hours early. Fix on their side, then add it back.
//   UT Austin (calendar.utexas.edu) — reads cleanly, but two thirds of it is
//     student services and athletics rather than public events. Add it with
//     CALENDAR_URLS if a campus feed is wanted.
//   Yellow Bike Project (austinyellowbike.org/events) — titles ship as
//     "Open | 12 – 6 PM" and the times are offset from the stated hours.
export const DEFAULT_CALENDAR_URLS = [
  AUSTIN_COMMON,
  AUSTIN_PARKS,
  SUSTAINABLE_FOOD_CENTER,
  WILDFLOWER_CENTER,
  SHALOM_AUSTIN,
  AUSTIN_BAT_CAVE,
];

// A browser-ish UA is not required by these sites (they answer the sync UA),
// but a few WordPress setups serve an empty page to unknown clients.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// The other direction, for WAFs that challenge impersonated browsers coming
// from datacenter ranges but let an honest client through.
const PLAIN_UA = 'GatherEventSync/1.0 (+https://github.com/10S-N/Gather)';

const CALENDAR_ACCEPT = 'text/calendar, text/html, application/xhtml+xml';

// Every seed runs on The Events Calendar, which serves the same listings as
// iCalendar from any event page via ?ical=1. That export is the fallback when
// the page itself is behind a bot challenge.
export function icalSibling(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.get('ical') === '1') return '';
    parsed.searchParams.set('ical', '1');
    return parsed.toString();
  } catch {
    return '';
  }
}

async function readOnce(target, ua, fetchImpl) {
  const body = await requestText(target, {
    fetchImpl,
    accept: CALENDAR_ACCEPT,
    headers: { 'user-agent': ua },
  });
  // Some hosts serve the interstitial with a 200, so a body is not proof of a
  // page. Treat it as the block it is and let the caller try something else.
  if (looksLikeBotWall(200, body)) {
    throw new HttpError('HTTP 200 bot challenge page', { status: 200, url: target, blocked: true });
  }
  return body;
}

// One calendar URL, up to four requests, and only the early ones are cheap: a
// healthy site answers the first attempt and nothing else happens. A challenge
// escalates through the same URL with a plain client UA, then the iCalendar
// export, because the block is about how the request looks, not about missing
// data.
async function readCalendar(url, { fetchImpl } = {}) {
  const notes = [];
  let blocked = false;

  const attempts = [
    { target: url, ua: BROWSER_UA, label: 'page' },
    { target: url, ua: PLAIN_UA, label: 'page, plain UA' },
  ];
  const sibling = icalSibling(url);
  if (sibling) {
    attempts.push({ target: sibling, ua: BROWSER_UA, label: 'iCal export' });
    attempts.push({ target: sibling, ua: PLAIN_UA, label: 'iCal export, plain UA' });
  }

  for (const { target, ua, label } of attempts) {
    try {
      return { body: await readOnce(target, ua, fetchImpl), url: target, notes };
    } catch (err) {
      const isBlock = Boolean(err?.blocked);
      notes.push(`${label}: ${err?.message || err}`);
      if (!isBlock) return { error: err, blocked, notes };
      blocked = true;
    }
  }

  return { blocked, notes, error: new HttpError(notes[notes.length - 1] || 'unreachable', { url }) };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

// schema.org dates are supposed to be W3C/ISO but publishers are loose:
// The Long Center ships "2026-11-1T18:00-5:00" (unpadded month/day, single-digit
// offset), which every JS date parser rejects. Normalize it before it reaches
// the shared date helpers.
export function normalizeSchemaDate(value) {
  const text = String(value ?? '').trim();
  const match = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:([+-])(\d{1,2}):?(\d{2}))?)?$/,
  );
  if (!match) return text;
  const [, year, month, day, hour, minute, second, sign, offsetHour, offsetMinute] = match;
  let out = `${year}-${pad(month)}-${pad(day)}`;
  if (hour) out += `T${pad(hour)}:${minute}:${second || '00'}`;
  if (sign) out += `${sign}${pad(offsetHour)}:${offsetMinute}`;
  return out;
}

// Local calendars are Austin calendars: the wall-clock time is the truth and
// the published offset is often wrong (publishers hard-code -05:00 year round,
// or emit UTC in an -06:00 field). Drop the offset so the normalizer reads the
// time as Austin wall clock, which is what a poster meant.
function toAustinWallClock(value) {
  const normalized = normalizeSchemaDate(value);
  if (!normalized) return { startAt: '', timeTba: false };
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  return {
    startAt: normalized.replace(/([+-]\d{2}):\d{2}$/, ''),
    timeTba: dateOnly,
  };
}

function collectEventNodes(node, out, depth = 0) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    for (const item of node) collectEventNodes(item, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;

  const types = [].concat(node['@type'] || node.type || []).map(String);
  if (types.some((type) => /Event$/.test(type))) {
    out.push(node);
    return; // nested sub-events of an event are not separate listings
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') collectEventNodes(value, out, depth + 1);
  }
}

// Pulls every schema.org Event out of a page's JSON-LD blocks. One block can be
// a single object, an array of events, or an @graph wrapper — all three show up
// on the Austin calendars we read.
export function parseJsonLdEvents(html = '') {
  const blocks = String(html).matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  const events = [];
  for (const [, raw] of blocks) {
    let data;
    try {
      data = JSON.parse(raw.trim());
    } catch {
      continue; // one malformed block must not hide the rest of the page
    }
    collectEventNodes(data, events);
  }
  return events;
}

// "1336 William Barton Dr, Austin, TX 78746" -> "Austin"
function cityFromAddress(value) {
  const text = String(value || '');
  if (LOCAL_CITY.test(text)) return 'Austin';
  const match = text.match(/([A-Za-z][A-Za-z .'-]*?),\s*(?:TX|Texas)\b/i);
  return match ? match[1].trim() : '';
}

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'object') return textOf(value.name || value['@value'] || '');
  return stripHtml(decodeEntities(String(value)));
}

function urlOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return urlOf(value.url || value['@id'] || '');
  return '';
}

function imageOf(value) {
  if (!value) return '';
  if (Array.isArray(value)) return imageOf(value[0]);
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return urlOf(value.url || value.contentUrl);
  return '';
}

function resolveUrl(value, base) {
  if (!value) return '';
  try {
    return new URL(value, base || undefined).toString();
  } catch {
    return '';
  }
}

function priceOf(node) {
  const offers = Array.isArray(node?.offers)
    ? node.offers.find((offer) => offer && typeof offer === 'object')
    : node?.offers;
  if (!offers || typeof offers !== 'object') return '';
  const raw = offers.price ?? offers.lowPrice ?? offers.highPrice;
  if (raw == null || raw === '') return '';
  const amount = Number(String(raw).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(amount)) return String(raw).slice(0, 40);
  if (amount <= 0) return 'Free';
  return `$${amount % 1 === 0 ? amount : amount.toFixed(2)}`;
}

// One schema.org Event object -> canonical raw event.
export function mapJsonLdEvent(node, { pageUrl = '' } = {}) {
  if (!node) return null;
  const status = String(node.eventStatus || '');
  if (/Canceled|Cancelled/i.test(status)) return null;
  if (/OnlineEventAttendanceMode/i.test(String(node.eventAttendanceMode || ''))) return null;

  const title = textOf(node.name);
  if (!title) return null;

  const { startAt, timeTba } = toAustinWallClock(node.startDate);
  if (!startAt) return null;
  const endRaw = toAustinWallClock(node.endDate);

  const place = Array.isArray(node.location) ? node.location[0] : node.location;
  const venueName =
    place && typeof place === 'object' ? textOf(place.name) : '';
  const placeAddress = place && typeof place === 'object' ? place.address : '';
  let address = '';
  let city = '';
  if (typeof placeAddress === 'string') {
    address = placeAddress;
    city = cityFromAddress(placeAddress);
  } else if (placeAddress && typeof placeAddress === 'object') {
    city = textOf(placeAddress.addressLocality);
    address = [
      textOf(placeAddress.streetAddress),
      [textOf(placeAddress.addressLocality), textOf(placeAddress.addressRegion)]
        .filter(Boolean)
        .join(', '),
      textOf(placeAddress.postalCode),
    ]
      .filter(Boolean)
      .join(', ');
  }
  if (!city && typeof place === 'string') {
    address = place;
    city = cityFromAddress(place);
  }

  const absoluteUrl = resolveUrl(urlOf(node.url), pageUrl);

  return {
    externalId: absoluteUrl || `${pageUrl}#${stableHash(`${title}|${startAt}`)}`,
    title,
    description: textOf(node.description),
    startAt,
    endAt: endRaw.startAt || '',
    timeTba,
    url: absoluteUrl,
    imageUrl: imageOf(node.image),
    venueName,
    address,
    city,
    price: priceOf(node),
    externalCategory: '',
    tags: [],
  };
}

// ICS LOCATION is free text: "Mohawk, 912 Red River St, Austin, TX 78701".
function splitIcsLocation(location = '') {
  const parts = String(location)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return { venueName: '', address: '', city: '' };
  return {
    venueName: parts.length > 1 ? parts[0] : '',
    address: parts.join(', '),
    city: cityFromAddress(parts.join(', ')),
  };
}

export function mapIcsCalendarEvent(item, { calendarUrl = '', timeZone } = {}) {
  const status = String(item.status || '').toUpperCase();
  if (status === 'CANCELLED' || status === 'CANCELED') return null;

  const startAt = parseIcsDate(item.start, { timeZone });
  if (!startAt) return null;
  const endAt = item.end ? parseIcsDate(item.end, { timeZone }) : null;
  const { venueName, address, city } = splitIcsLocation(item.location);

  return {
    externalId: item.uid || `${calendarUrl}#${stableHash(`${item.summary || ''}|${item.start || ''}`)}`,
    title: item.summary || '',
    description: item.description || '',
    startAt,
    endAt: endAt && endAt > startAt ? endAt : null,
    timeTba: Boolean(item.startIsDate),
    url: item.url || calendarUrl,
    imageUrl: '',
    venueName,
    address,
    city,
    price: '',
    externalCategory: '',
    tags: [],
  };
}

function calendarUrls(env = {}) {
  const extra = splitList(env.CALENDAR_URLS);
  const defaultsOff = /^(0|false|off|no)$/i.test(String(env.CALENDAR_DEFAULTS ?? '').trim());
  return defaultsOff ? extra : [...DEFAULT_CALENDAR_URLS, ...extra];
}

export const calendarsSource = {
  id: 'calendars',
  label: 'Community calendars',
  kind: 'scraper',
  envVars: ['CALENDAR_URLS', 'CALENDAR_DEFAULTS'],
  docsUrl: 'https://theaustincommon.com/events/',
  // Ships with a verified Austin seed list, so a fresh clone scrapes these
  // without any configuration.
  isConfigured: () => true,

  async fetchEvents({ env = {}, fetchImpl, timeZone, logger = console } = {}) {
    const urls = calendarUrls(env);
    // CALENDAR_DEFAULTS=off with nothing in CALENDAR_URLS leaves the source with
    // no work at all; say so instead of reporting a successful zero-event run.
    if (!urls.length) {
      throw new Error(
        'CALENDAR_DEFAULTS is off and CALENDAR_URLS is empty, so there are no community calendars to read.',
      );
    }
    const seen = new Set();
    const raw = [];
    const failures = [];
    let readable = 0;

    for (const url of urls) {
      const result = await readCalendar(url, { fetchImpl });
      if (!result.body) {
        failures.push({ url, blocked: result.blocked, reason: result.notes.join(' · ') });
        logger?.warn?.(
          `[calendars] ${url} ${result.blocked ? 'blocked by bot protection' : 'failed'}: ` +
            `${result.notes[result.notes.length - 1] || 'unreachable'}`,
        );
        continue;
      }
      readable += 1;
      if (result.notes.length) {
        // Worth saying out loud: this calendar only answered on a fallback.
        logger?.warn?.(`[calendars] ${url} read through a fallback (${result.notes.join(' · ')})`);
      }

      const body = result.body;
      const pageUrl = result.url || url;
      const items = /BEGIN:VCALENDAR/i.test(body)
        ? parseIcs(body).map((item) => mapIcsCalendarEvent(item, { calendarUrl: pageUrl, timeZone }))
        : parseJsonLdEvents(body).map((node) => mapJsonLdEvent(node, { pageUrl }));

      let kept = 0;
      for (const item of items) {
        if (!item) continue;
        if (item.city && !LOCAL_CITY.test(item.city)) continue;
        if (!item.externalId || seen.has(item.externalId)) continue;
        seen.add(item.externalId);
        raw.push(item);
        kept += 1;
      }
      logger?.debug?.(`[calendars] ${url} -> ${kept} local events`);
    }

    // Nothing could be read at all. Reporting zero events here would look like
    // every Austin calendar is empty and, with --prune, would treat this source
    // as authoritative — say what happened instead.
    if (!readable && failures.length) {
      const hosts = [
        ...new Set(
          failures
            .filter((failure) => failure.blocked)
            .map((failure) => {
              try {
                return new URL(failure.url).host;
              } catch {
                return failure.url;
              }
            }),
        ),
      ];
      const detail = hosts.length
        ? `${hosts.length} of ${failures.length} unreachable calendars are blocked by bot protection (${hosts.join(', ')})`
        : 'every request failed';
      throw new Error(
        `Read none of the ${urls.length} community calendars — ${detail}. ` +
          'Nothing was imported, so existing listings are left in place.',
      );
    }

    return raw;
  },
};


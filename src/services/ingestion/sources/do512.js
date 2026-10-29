// Do512 ingestion adapter (public HTML, no credentials).
//
// Do512 is the longest-running Austin event calendar, and every listing card is
// marked up with schema.org microdata (`itemprop="event"`, `startDate`,
// `location` → `streetAddress`). That microdata is the scrape target: it is far
// more stable than the site's CSS classes, and it gives us a real start time and
// a real street address for every event, which is what the normalizer needs to
// place something in a neighborhood.
//
// This is a polite scraper, not a crawler: it reads one date page per day
// (`/events/YYYY/MM/DD`) for DO512_DAYS days, once per sync run.
//
// Recurring series (weekly trivia, every-Tuesday dance lessons) are listed on
// the day page they fall on, but their schema.org `startDate` is the *series*
// start — "Every Tue" carrying the first Tuesday it ever ran. Those cards are
// re-dated onto the day page they were found on, so a recurring listing does
// not get thrown away as already-ended.
//
// Config:
//   DO512_DAYS=7        # how many day pages to read (1–21, default 7)

import { requestText } from '../http.js';
import { AUSTIN_TIME_ZONE, addDays, isoDay } from '../time.js';
import { decodeEntities, stripHtml } from '../text.js';

const BASE = 'https://do512.com';
const DEFAULT_DAYS = 7;
const MAX_DAYS = 21;

// Do512 answers 403 to obvious bots. Any real browser string works, and the
// page we get back is identical to what a visitor sees.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// The page also lists nearby towns; the board's taxonomy is Austin only.
const LOCAL_CITY = /austin/i;

// Do512 tags every card with `ds-event-category-<slug>`. Those slugs are a far
// better category signal than the title, so map them onto the labels the
// taxonomy's external-category table already understands.
const CATEGORY_SLUGS = [
  [/^(live-music|music)$/, 'Music'],
  [/(market|pop-up|popup|shopping|flea|swap|sale|vendor)/, 'Pop-ups'],
  [/(food|drink|beer|wine|brunch|dinner|cocktail)/, 'Food & Drink'],
  [/(fitness|health|wellness|yoga|meditation|sports|run)/, 'Wellness'],
  [/(outdoor|nature|hike|garden|park|bike)/, 'Outdoors'],
  [/(workshop|class|education|lecture|seminar|tech|business|career)/, 'Workshops'],
  [/(art|culture|gallery|theater|theatre|film|comedy|drag|dance|poetry|spoken)/, 'Art'],
  [/(community|local|civic|volunteer|activism|politics|nonprofit|lgbtq|family|kids|karaoke|games)/, 'Community'],
];

// Virtual listings are never placed on the board.
const VIRTUAL_SLUG = /(online|virtual|digital|stream)/;

function categoryFromSlug(slug = '') {
  for (const [pattern, label] of CATEGORY_SLUGS) {
    if (pattern.test(slug)) return label;
  }
  return '';
}

// A one-off listing links to its own dated page (`/events/2026/10/27/slug`,
// sometimes unpadded as `/events/2026/9/26/slug`). A recurring series links to
// `/events/weekly/tue/slug` — no date segment at all, which is the signal that
// its startDate is the series start rather than the occurrence.
const DATED_PERMALINK = /^\/events\/\d{4}\/\d{1,2}\/\d{1,2}\//;

function timeOfDay(value) {
  const match = String(value || '').match(/T(\d{2}:\d{2})/);
  return match ? match[1] : '';
}

function nextIsoDay(day) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// Moves a recurring card onto the day page it was listed on, keeping the
// card's wall-clock time (Do512 times are Austin local, which is how the
// normalizer reads a floating "YYYY-MM-DDTHH:MM" string).
function moveToPageDay({ permalink, startAt, endAt, pageDay }) {
  if (!pageDay || DATED_PERMALINK.test(permalink)) return null;
  const startTime = timeOfDay(startAt);
  if (!startTime) return null;
  // Never move a card *later* — the series start is always what we are fixing.
  if (String(startAt).slice(0, 10) > pageDay) return null;

  const endTime = timeOfDay(endAt);
  // A series that runs past midnight (doors 11pm, music 1am) ends the next day.
  const endDay = endTime && endTime < startTime ? nextIsoDay(pageDay) : pageDay;
  return {
    startAt: `${pageDay}T${startTime}`,
    endAt: endTime ? `${endDay}T${endTime}` : '',
  };
}

function metaContent(html, prop) {
  const forward = html.match(new RegExp(`itemprop="${prop}"[^>]*content="([^"]*)"`, 'i'));
  if (forward) return forward[1];
  const backward = html.match(new RegExp(`content="([^"]*)"[^>]*itemprop="${prop}"`, 'i'));
  return backward ? backward[1] : '';
}

function textOf(html) {
  return stripHtml(decodeEntities(String(html || '').replace(/<[^>]+>/g, ' '))).trim();
}

// Schema.org microdata for a single listing card -> canonical raw event.
// Exported so the parser can be tested against saved markup.
export function parseDo512Card(chunk, { pageDay = '' } = {}) {
  const permalinkMatch = String(chunk).match(/data-permalink="([^"]+)"/);
  if (!permalinkMatch) return null;
  const permalink = permalinkMatch[1];
  if (!/^\/events\//.test(permalink)) return null;
  if (!/schema\.org\/Event/i.test(chunk)) return null;

  const startMatch = chunk.match(/itemprop="startDate"[^>]*datetime="([^"]+)"/i);
  if (!startMatch) return null; // "date TBA" cards are useless to us
  const endMatch = chunk.match(/itemprop="endDate"[^>]*datetime="([^"]+)"/i);

  const shifted = moveToPageDay({
    permalink,
    startAt: startMatch[1],
    endAt: endMatch ? endMatch[1] : '',
    pageDay,
  });
  const startAt = shifted ? shifted.startAt : startMatch[1];
  const endAt = shifted && shifted.endAt ? shifted.endAt : endMatch ? endMatch[1] : null;

  const titleMatch =
    chunk.match(/ds-listing-event-title-text[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/span>/i) ||
    chunk.match(/itemprop="name"[^>]*>([\s\S]*?)<\/span>/i);
  const title = textOf(titleMatch?.[1] || '');
  if (!title) return null;

  // Venue block: everything from the location marker to the end of its div.
  const locationChunk = (chunk.match(/itemprop="location"[\s\S]{0,1500}/i) || [''])[0];
  const venueMatch = locationChunk.match(/itemprop="name"[^>]*>([\s\S]*?)<\/span>/i);
  const venueName = textOf(venueMatch?.[1] || '');

  const street = metaContent(locationChunk, 'streetAddress');
  const city = metaContent(locationChunk, 'addressLocality');
  const region = metaContent(locationChunk, 'addressRegion');
  const postal = metaContent(locationChunk, 'postalCode');
  const address = [street, [city, region].filter(Boolean).join(', '), postal]
    .filter(Boolean)
    .join(', ');

  const imageMatch = chunk.match(/background-image:\s*url\(['"]?([^'")]+)/i);
  const imageUrl = imageMatch ? new URL(imageMatch[1].trim(), BASE).toString() : '';

  const slugMatch = chunk.match(/ds-event-category-([a-z0-9-]+)/i);
  const categorySlug = slugMatch ? slugMatch[1].toLowerCase() : '';
  if (VIRTUAL_SLUG.test(categorySlug)) return null;

  return {
    externalId: permalink,
    title,
    // Card markup carries no blurb; the normalizer fills a source pointer.
    description: '',
    startAt,
    endAt,
    url: new URL(permalink, BASE).toString(),
    imageUrl,
    venueName,
    address,
    city,
    lat: null,
    lng: null,
    price: '',
    externalCategory: categoryFromSlug(categorySlug),
    tags: [],
  };
}

// Splits a listing page into cards. Every card starts at its wrapper's class
// attribute, which also carries the `ds-event-category-*` slug — splitting on
// the permalink instead would push that slug into the previous card.
// `pageDay` is the local day of the page being parsed; recurring cards use it
// to replace their series start date.
export function parseDo512Page(html = '', { pageDay = '' } = {}) {
  const chunks = String(html).split(/ds-listing event-card/i);
  chunks.shift(); // markup before the first card
  const events = [];
  for (const chunk of chunks) {
    const parsed = parseDo512Card(chunk, { pageDay });
    if (parsed) events.push(parsed);
  }
  return events;
}

function dayPages(now, days) {
  const pages = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = isoDay(addDays(now, offset), AUSTIN_TIME_ZONE);
    const [year, month, date] = day.split('-');
    pages.push({ day, url: `${BASE}/events/${year}/${month}/${date}` });
  }
  return pages;
}

function daysFor(env = {}) {
  const value = Number.parseInt(String(env.DO512_DAYS ?? ''), 10);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_DAYS;
  return Math.min(value, MAX_DAYS);
}

export const do512Source = {
  id: 'do512',
  label: 'Do512',
  kind: 'scraper',
  envVars: ['DO512_DAYS'],
  docsUrl: 'https://do512.com/events',
  // Public pages, no key required — this is the source that works on a fresh
  // clone with no configuration at all.
  isConfigured: () => true,

  async fetchEvents({ env = {}, fetchImpl, now = new Date(), logger = console } = {}) {
    const days = daysFor(env);
    const seen = new Set();
    const raw = [];

    for (const { day, url } of dayPages(now, days)) {
      let html;
      try {
        html = await requestText(url, {
          fetchImpl,
          accept: 'text/html,application/xhtml+xml',
          headers: { 'user-agent': BROWSER_UA },
        });
      } catch (err) {
        // One bad day page must not sink the run.
        logger?.warn?.(`[do512] ${url} failed: ${err?.message || err}`);
        continue;
      }

      let kept = 0;
      for (const event of parseDo512Page(html, { pageDay: day })) {
        if (event.city && !LOCAL_CITY.test(event.city)) continue;
        if (seen.has(event.externalId)) continue;
        seen.add(event.externalId);
        raw.push(event);
        kept += 1;
      }
      logger?.debug?.(`[do512] ${url} -> ${kept} local events`);
    }

    return raw;
  },
};

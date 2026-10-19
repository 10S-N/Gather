// Luma (lu.ma) adapter.
//
// Luma publishes a public iCalendar feed for every calendar, which is perfect
// for this job: no API key, no scraping of HTML, and it includes the venue text
// and canonical event URL. Feeds are CORS-blocked in browsers, so this runs
// server-side only.
//
// Config:
//   LUMA_CALENDARS=austinindie,another-calendar
//   (full https://lu.ma/<slug>/ics URLs are also accepted)

import { parseIcs } from '../ics.js';
import { requestText } from '../http.js';
import { parseIcsDate } from '../time.js';
import { splitList, stableHash, stripHtml } from '../text.js';

const DEFAULT_BASE = 'https://lu.ma';
const CANCELLED = new Set(['CANCELLED', 'CANCELED']);

export function icsUrlFor(calendar, base = DEFAULT_BASE) {
  const value = String(calendar || '').trim();
  if (/^https?:\/\//i.test(value)) return value;
  const slug = value.replace(/^\/+|\/+$/g, '');
  return `${base}/${slug}/ics`;
}

// ICS LOCATION is free text: "Mohawk, 912 Red River St, Austin, TX 78701".
function splitLocation(location = '') {
  const parts = String(location)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return { venueName: '', address: '' };
  const venueName = parts[0];
  const address = parts.length > 1 ? parts.join(', ') : parts[0];
  return { venueName, address };
}

export function mapLumaEvent(item, { calendar = '', timeZone } = {}) {
  const startAt = parseIcsDate(item.start, { timeZone });
  const endAt = item.end ? parseIcsDate(item.end, { timeZone }) : null;
  const { venueName, address } = splitLocation(item.location);
  const externalId =
    item.uid ||
    `${calendar}:${stableHash(`${item.summary || ''}|${item.start || ''}`)}`;

  return {
    externalId,
    title: item.summary || '',
    description: stripHtml(item.description || ''),
    startAt,
    endAt,
    url: item.url || '',
    imageUrl: '',
    venueName,
    address,
    price: '',
    externalCategory: '',
    tags: [],
  };
}

export const lumaSource = {
  id: 'luma',
  label: 'Luma',
  kind: 'ics',
  envVars: ['LUMA_CALENDARS'],
  docsUrl: 'https://help.lu.ma',
  isConfigured: (env = {}) => splitList(env.LUMA_CALENDARS).length > 0,

  async fetchEvents({ env = {}, fetchImpl, timeZone } = {}) {
    const calendars = splitList(env.LUMA_CALENDARS);
    if (!calendars.length) throw new Error('LUMA_CALENDARS is not set');

    const raw = [];
    for (const calendar of calendars) {
      const url = icsUrlFor(calendar);
      const ics = await requestText(url, { fetchImpl });
      const items = parseIcs(ics);
      for (const item of items) {
        if (CANCELLED.has(String(item.status || '').toUpperCase())) continue;
        raw.push(mapLumaEvent(item, { calendar, timeZone }));
      }
    }
    return raw;
  },
};


// Minimal iCalendar (RFC 5545) reader. We only need VEVENT fields, so this
// deliberately ignores recurrence expansion, attendees, and alarms. Calendar
// feeds (Luma and most indie calendars) publish concrete instances, which is
// exactly what a local event board wants.

import { normalizeWhitespace } from './text.js';

// Long descriptions are folded across lines: continuation lines start with a
// single space or tab (RFC 5545 §3.1).
function unfoldLines(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function unescapeValue(value) {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// Splits `DTSTART;TZID=America/Chicago:20261024T193000` into name/params/value
// while respecting quoted parameter values that may contain a colon.
function parseProperty(line) {
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if (char === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(';');
  const params = {};
  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

function parseEvents(block) {
  const event = {};
  for (const line of block) {
    const prop = parseProperty(line);
    if (!prop) continue;
    switch (prop.name) {
      case 'UID':
        event.uid = prop.value.trim();
        break;
      case 'SUMMARY':
        event.summary = unescapeValue(prop.value).trim();
        break;
      case 'DESCRIPTION':
        event.description = normalizeWhitespace(unescapeValue(prop.value));
        break;
      case 'LOCATION':
        event.location = normalizeWhitespace(unescapeValue(prop.value));
        break;
      case 'URL':
        event.url = prop.value.trim();
        break;
      case 'STATUS':
        event.status = prop.value.trim().toUpperCase();
        break;
      case 'DTSTART':
        event.start = prop.value.trim();
        event.startTzid = prop.params.TZID || null;
        // RFC 5545 defaults to VALUE=DATE for date-only values, so a bare
        // `DTSTART:20261115` is an all-day event even without the parameter.
        event.startIsDate =
          (prop.params.VALUE || '').toUpperCase() === 'DATE' || /^\d{8}$/.test(event.start);
        break;
      case 'DTEND':
        event.end = prop.value.trim();
        event.endTzid = prop.params.TZID || null;
        break;
      case 'ORGANIZER':
        event.organizer = (prop.params.CN || '').replace(/^"|"$/g, '') || null;
        break;
      default:
        break;
    }
  }
  return event;
}

// Returns an array of raw VEVENT objects:
//   { uid, summary, description, location, url, status, start, startTzid,
//     startIsDate, end, endTzid, organizer }
export function parseIcs(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = unfoldLines(text);
  const events = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^BEGIN:VEVENT$/i.test(trimmed)) {
      current = [];
      continue;
    }
    if (/^END:VEVENT$/i.test(trimmed)) {
      if (current) {
        const parsed = parseEvents(current);
        if (parsed.summary || parsed.start) events.push(parsed);
      }
      current = null;
      continue;
    }
    if (current) current.push(trimmed);
  }

  return events;
}

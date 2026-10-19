// Austin's local wall-clock time is what every feed means when it omits an
// offset ("2026-10-24T19:30"). Firestore stores instants (UTC), so we convert
// through Intl rather than trusting the machine's own timezone.

export const AUSTIN_TIME_ZONE = 'America/Chicago';

const formatterCache = new Map();

function partsFormatter(timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(date, timeZone) {
  const parts = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

// How far the zone's wall clock is ahead of UTC at a given instant (ms).
function zoneOffsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

// Converts a wall-clock time in `timeZone` into the matching UTC Date.
// The offset is resolved twice so times near a DST boundary land correctly.
export function zonedTimeToUtc(
  { year, month, day, hour = 0, minute = 0, second = 0 },
  timeZone = AUSTIN_TIME_ZONE,
) {
  const base = Date.UTC(year, month - 1, day, hour, minute, second);
  let stamp = base - zoneOffsetMs(new Date(base), timeZone);
  stamp = base - zoneOffsetMs(new Date(stamp), timeZone);
  return new Date(stamp);
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const FLOATING = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

// Accepts Dates, Firestore Timestamps, epoch ms, ISO strings with an offset,
// and floating local strings (interpreted as Austin time).
export function parseDateValue(value, { timeZone = AUSTIN_TIME_ZONE } = {}) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    return parseDateValue(value.toDate(), { timeZone });
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }

  const text = String(value).trim();
  if (!text) return null;

  const dateOnly = text.match(DATE_ONLY);
  if (dateOnly) {
    return zonedTimeToUtc(
      { year: Number(dateOnly[1]), month: Number(dateOnly[2]), day: Number(dateOnly[3]) },
      timeZone,
    );
  }

  const floating = text.match(FLOATING);
  if (floating) {
    return zonedTimeToUtc(
      {
        year: Number(floating[1]),
        month: Number(floating[2]),
        day: Number(floating[3]),
        hour: Number(floating[4]),
        minute: Number(floating[5]),
        second: Number(floating[6] || 0),
      },
      timeZone,
    );
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ICS: `20261024T193000Z`, `20261024T193000`, `20261024`.
export function parseIcsDate(value, { timeZone = AUSTIN_TIME_ZONE } = {}) {
  if (!value) return null;
  const text = String(value).trim();
  const utc = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utc) {
    return new Date(
      Date.UTC(
        Number(utc[1]),
        Number(utc[2]) - 1,
        Number(utc[3]),
        Number(utc[4]),
        Number(utc[5]),
        Number(utc[6]),
      ),
    );
  }
  const local = text.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?$/);
  if (local) {
    return zonedTimeToUtc(
      {
        year: Number(local[1]),
        month: Number(local[2]),
        day: Number(local[3]),
        hour: Number(local[4] || 0),
        minute: Number(local[5] || 0),
        second: Number(local[6] || 0),
      },
      timeZone,
    );
  }
  return parseDateValue(text, { timeZone });
}

// `2026-10-24` as seen from the given zone. Used for stable dedupe keys.
export function isoDay(date, timeZone = AUSTIN_TIME_ZONE) {
  const parsed = parseDateValue(date, { timeZone });
  if (!parsed) return '';
  const p = zonedParts(parsed, timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

// Explicit extension so this module can also be imported from Node tests
// (Vite resolves both forms).
import { CATEGORIES } from '../data/neighborhoods.js';

// Shared, framework-free event helpers. Everything here is pure so date
// filtering, normalization, and validation can be reasoned about (and tested)
// without Firestore or React.

const EVENT_GRACE_MS = 6 * 60 * 60 * 1000; // keep listed for 6h after start
const MAX_TAGS = 6;
const MAX_TAG_LENGTH = 24;
const MAX_TITLE = 120;
const MIN_DESCRIPTION = 20;
const MAX_DESCRIPTION = 4000;
const MAX_ADDRESS = 160;

export const WHEN_OPTIONS = [
  { value: 'all', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'weekend', label: 'This weekend' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'month', label: 'Next 30 days' },
];

// Accepts Firestore Timestamps, Dates, ISO strings, and epoch numbers.
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value?.toDate === 'function') {
    try {
      const d = value.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof value?.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

// Fallbacks for curated rows written before a source ships a `sourceLabel`.
const SOURCE_LABELS = {
  eventbrite: 'Eventbrite',
  luma: 'Luma',
  rss: 'Local calendar',
};

// Maps a Firestore `events/{id}` document into the shape every component uses.
// Two origins share the collection: 'community' (a neighbor posted it) and
// 'curated' (the ingestion pipeline synced it from a local calendar).
export function normalizeCommunityEvent(id, data = {}) {
  const startAt = toDate(data.startAt) || toDate(data.date) || null;
  const endAt = toDate(data.endAt) || null;
  const isCurated = data.origin === 'curated';
  const tags = Array.isArray(data.tags)
    ? data.tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, MAX_TAGS)
    : [];

  return {
    id,
    source: isCurated ? 'curated' : 'community',
    origin: isCurated ? 'curated' : 'community',
    sourceId: isCurated ? data.source || '' : 'community',
    sourceLabel: isCurated
      ? data.sourceLabel || SOURCE_LABELS[data.source] || 'Local calendar'
      : '',
    externalId: isCurated ? data.externalId || '' : '',
    sourceUrl: isCurated ? data.sourceUrl || '' : '',
    url: isCurated ? data.sourceUrl || data.rsvpUrl || '' : data.url || '',
    title: data.title || 'Untitled event',
    description: data.description || '',
    category: data.category || 'Community',
    tags,
    neighborhood: data.neighborhood || '',
    address: data.address || '',
    location: data.address || data.neighborhood || 'Austin, TX',
    startAt,
    endAt,
    date: startAt ? formatEventDate(startAt) : data.date || '',
    time: startAt ? formatEventTime(startAt) : '',
    image: data.imageUrl || data.image || '',
    imageUrl: data.imageUrl || '',
    price: isCurated ? data.price || '' : data.price || 'Free',
    capacity:
      !isCurated && Number.isFinite(Number(data.capacity)) && Number(data.capacity) > 0
        ? Number(data.capacity)
        : null,
    // Curated rows never take an internal RSVP; the original listing owns it.
    attendeeCount: isCurated
      ? null
      : Number.isFinite(Number(data.attendeeCount))
        ? Math.max(0, Number(data.attendeeCount))
        : 0,
    rsvpUrl: data.rsvpUrl || '',
    hostUid: data.hostUid || '',
    hostName: data.hostName || 'A neighbor',
    hostPhotoURL: data.hostPhotoURL || '',
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

// Maps a Ticketmaster/sample event into the card shape. These are read-only
// listings: they never get an internal RSVP.
export function normalizeExternalEvent(ev) {
  return {
    ...ev,
    source: ev.source === 'Ticketmaster' ? 'ticketmaster' : 'sample',
    startAt: toDate(ev.startAt),
    neighborhood: ev.neighborhood || ev.location || '',
    tags: ev.tags || [],
    attendeeCount: null,
    capacity: null,
    hostName: ev.hostName || '',
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatEventDate(date) {
  const d = toDate(date);
  if (!d) return '';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatEventTime(date) {
  const d = toDate(date);
  if (!d) return '';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatLongDate(date) {
  const d = toDate(date);
  if (!d) return '';
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// "Sat, Oct 24 · 7:00 PM"
export function formatWhen(event) {
  if (event?.startAt) {
    const date = formatEventDate(event.startAt);
    const time = formatEventTime(event.startAt);
    return time ? `${date} · ${time}` : date;
  }
  return event?.date || 'Date TBA';
}

export function formatRelative(now, ts) {
  const diff = now - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export function eventEndDate(event) {
  if (event?.endAt) return event.endAt;
  const start = toDate(event?.startAt);
  return start ? new Date(start.getTime() + EVENT_GRACE_MS) : null;
}

export function isPastEvent(event, now = new Date()) {
  const end = eventEndDate(event);
  return end ? end.getTime() < now.getTime() : false;
}

export function sortByStart(a, b) {
  const av = toDate(a.startAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bv = toDate(b.startAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  return av - bv;
}

export function matchesWhen(startAt, when, now = new Date()) {
  if (!when || when === 'all') return true;
  const d = toDate(startAt);
  if (!d) return false;

  const today = startOfDay(now);
  switch (when) {
    case 'today':
      return startOfDay(d).getTime() === today.getTime();
    case 'tomorrow':
      return startOfDay(d).getTime() === addDays(today, 1).getTime();
    case 'weekend': {
      const daysUntilSunday = (7 - today.getDay()) % 7;
      const end = addDays(today, daysUntilSunday);
      end.setHours(23, 59, 59, 999);
      return d.getTime() >= today.getTime() && d.getTime() <= end.getTime();
    }
    case 'week': {
      const end = addDays(today, 7);
      end.setHours(23, 59, 59, 999);
      return d.getTime() >= today.getTime() && d.getTime() <= end.getTime();
    }
    case 'month': {
      const end = addDays(today, 30);
      end.setHours(23, 59, 59, 999);
      return d.getTime() >= today.getTime() && d.getTime() <= end.getTime();
    }
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Filtering / sorting
// ---------------------------------------------------------------------------

export function filterEvents(
  events,
  { category = 'All', neighborhood = 'All', when = 'all', query = '', includePast = false } = {},
  now = new Date(),
) {
  const normalizedQuery = query.trim().toLowerCase();

  return events.filter((event) => {
    if (!includePast && isPastEvent(event, now)) return false;
    if (category !== 'All' && event.category !== category) return false;
    if (neighborhood !== 'All' && event.neighborhood !== neighborhood) return false;
    if (!matchesWhen(event.startAt, when, now)) return false;

    if (!normalizedQuery) return true;
    const haystack = [
      event.title,
      event.description,
      event.category,
      event.neighborhood,
      event.location,
      event.address,
      event.hostName,
      ...(event.tags || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function sortEvents(events) {
  return [...events].sort(sortByStart);
}

// ---------------------------------------------------------------------------
// Form handling
// ---------------------------------------------------------------------------

export function parseTags(input) {
  if (!input) return [];
  const seen = new Set();
  const tags = [];
  for (const raw of String(input).split(',')) {
    const tag = raw.trim().replace(/^#/, '').slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

export function isHttpUrl(value) {
  if (!value) return true; // optional fields are valid when empty
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function combineDateTime(date, time) {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// `date`/`time` are the raw <input> values ("2026-10-24", "19:30").
export function validateEventForm(form, now = new Date()) {
  const errors = {};
  const title = (form.title || '').trim();
  const description = (form.description || '').trim();

  if (title.length < 3) errors.title = 'Give your event a title (3+ characters).';
  else if (title.length > MAX_TITLE) errors.title = `Keep the title under ${MAX_TITLE} characters.`;

  if (description.length < MIN_DESCRIPTION) {
    errors.description = `Add at least ${MIN_DESCRIPTION} characters so people know what to expect.`;
  } else if (description.length > MAX_DESCRIPTION) {
    errors.description = `Descriptions are capped at ${MAX_DESCRIPTION} characters.`;
  }

  if (!CATEGORIES.includes(form.category)) errors.category = 'Pick a category.';

  if (!form.neighborhood) errors.neighborhood = 'Pick a neighborhood.';
  if (!(form.address || '').trim()) errors.address = 'Add a street address or venue.';
  else if (form.address.trim().length > MAX_ADDRESS) errors.address = 'Address is too long.';

  const startAt = combineDateTime(form.date, form.time);
  const todayStart = startOfDay(now).getTime();

  if (!form.date) {
    errors.date = 'Pick a date.';
  } else {
    const dateStart = startOfDay(new Date(`${form.date}T00:00`));
    if (Number.isNaN(dateStart.getTime())) {
      errors.date = 'That date could not be read.';
    } else if (dateStart.getTime() < todayStart) {
      // A date before today is never valid, with or without a time. In edit
      // mode callers pass an epoch `now` so hosts can fix typos on past events.
      errors.date = 'Pick a future date — this one has already passed.';
    }
  }

  if (!form.time) {
    errors.time = 'Pick a start time.';
  } else if (!startAt && !errors.date) {
    errors.date = 'That date and time could not be read.';
  }

  // Allow backdating by a few hours (people post as things get going) but not
  // events that already finished.
  if (startAt && !errors.date && startAt.getTime() < now.getTime() - 6 * 60 * 60 * 1000) {
    errors.date = 'Pick a future date — this one has already passed.';
  }

  if (form.endTime && startAt) {
    const endAt = combineDateTime(form.date, form.endTime);
    if (!endAt) errors.endTime = 'That end time could not be read.';
    else if (endAt.getTime() <= startAt.getTime()) errors.endTime = 'End time must be after the start.';
  }

  const capacity = String(form.capacity ?? '').trim();
  if (capacity) {
    const n = Number(capacity);
    if (!Number.isInteger(n) || n <= 0) errors.capacity = 'Capacity must be a whole number above 0.';
    else if (n > 100000) errors.capacity = 'That capacity looks too high.';
  }

  if (!isHttpUrl(form.imageUrl)) errors.imageUrl = 'Image URL must start with http:// or https://.';
  if (!isHttpUrl(form.rsvpUrl)) errors.rsvpUrl = 'RSVP link must start with http:// or https://.';

  return errors;
}

// Converts the validated form into the Firestore document body. Timestamps are
// created by the caller (firebase/firestore) so this stays framework-free.
export function buildEventPayload(form, { makeTimestamp, isEdit = false } = {}) {
  const startAt = combineDateTime(form.date, form.time);
  const endAt = combineDateTime(form.date, form.endTime);

  return {
    title: form.title.trim(),
    description: form.description.trim(),
    category: form.category,
    tags: parseTags(form.tags),
    neighborhood: form.neighborhood,
    address: form.address.trim(),
    startAt: makeTimestamp(startAt),
    endAt: endAt ? makeTimestamp(endAt) : null,
    imageUrl: (form.imageUrl || '').trim(),
    rsvpUrl: (form.rsvpUrl || '').trim(),
    price: (form.price || 'Free').trim() || 'Free',
    capacity: String(form.capacity ?? '').trim()
      ? Number(form.capacity)
      : null,
    ...(isEdit ? {} : { attendeeCount: 0 }),
  };
}

// Formats a Date into values usable by <input type="date"> / <input type="time">.
export function dateInputValue(date) {
  const d = toDate(date);
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function timeInputValue(date) {
  const d = toDate(date);
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export { MAX_TAGS, MAX_TITLE, MIN_DESCRIPTION };

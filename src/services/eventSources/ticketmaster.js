// Ticketmaster Discovery API adapter.
//
// Notes for the team:
//   - Sign up for a free consumer API key at https://developer.ticketmaster.com/
//   - The free tier allows 5,000 API calls per day; we cache on the client for 1 hour
//     so a typical browse session only makes one call.
//   - The Discovery API explicitly allows browser CORS, so no backend proxy is needed.
//   - Place the key in `.env.local` as `VITE_TICKETMASTER_KEY=...`. (Any client-exposed
//     key can technically be scraped, so we keep the free-tier scope. Move to a
//     Cloud Function later if you upgrade to paid tier.)
//
// Schema we map into (matches the existing app's event shape):
//   { id, title, date, location, price, category, image, url, source, description }

const ENDPOINT = 'https://app.ticketmaster.com/discovery/v2/events.json';

// Category hints we lift onto Gather's neighborhood taxonomy.
const CATEGORY_MAP = [
  { match: ['music'], category: 'Music/Indie' },
  { match: ['sports'], category: 'Community' },
  { match: ['family'], category: 'Community' },
  { match: ['arts', 'theatre', 'theater', 'film'], category: 'Art' },
  { match: ['food', 'drink'], category: 'Food & Drink' },
  { match: ['miscellaneous'], category: 'Community' },
];

function mapCategory(tmClassifications) {
  const segments = (tmClassifications ?? [])
    .flatMap((c) => [
      ...(c.segment?.name ? [c.segment.name.toLowerCase()] : []),
      ...(c.genre?.name ? [c.genre.name.toLowerCase()] : []),
    ]);
  for (const { match, category } of CATEGORY_MAP) {
    if (segments.some((s) => match.some((m) => s.includes(m)))) return category;
  }
  return 'Community';
}

// Status codes we never want to surface. The Discovery API has no query
// param to filter these out, so we drop them client-side after parsing.
const DROP_STATUS_CODES = new Set([
  'cancelled',
  'postponed',
  'rescheduled',
  'offsale',
]);

// Title/noun patterns that almost always indicate a non-event listing that
// crawled into the result set (parking passes, VIP add-ons, packages, etc.).
// Match is case-insensitive against the event name.
// NOTE: Test fixtures are already filtered server-side via the `includeTest=no`
// query param, so we don't add a client-side rule for "test" titles (which
// would also drop legitimate events like "Test Drive", "Test Match", etc.).
const PLACEHOLDER_KEYWORDS = [
  /\bparking\b/i,
  /\bparking pass\b/i,
  /\bvip package\b/i,
  /\bexperience pass\b/i,
  /\bclub pass\b/i,
  /\bfast lane\b/i,
  /\bmeet & greet\b/i,
  /\bmeet and greet\b/i,
  /\bmerchandise\b/i,
  /\bpre-?show\b/i,
  /\bpremiere package\b/i,
  /\bupgraded experience\b/i,
  /^\s*placeholder\b/i,
  /\blorem ipsum\b/i,
];

// Returns true if the event passes our quality bar. Strict on status /
// placeholder / required fields; lenient on venue (some events legitimately
// don't have one, e.g. digital events).
function isRealEvent(raw) {
  if (!raw?.id) return false;
  if (!raw?.name || raw.name.trim().length < 3) return false;

  const status = raw.dates?.status?.code;
  if (status && DROP_STATUS_CODES.has(status)) return false;

  // Require either a precise startDateTime OR a localDate. Without either,
  // we can't display or sort the event usefully.
  const start = raw.dates?.start;
  if (!start?.dateTime && !start?.localDate) return false;

  // Reject names that look like a parking pass, VIP package, etc.
  if (PLACEHOLDER_KEYWORDS.some((re) => re.test(raw.name))) return false;

  return true;
}

// Builds the `startDateTime` query param the Discovery API expects.
// Format: `YYYY-MM-DDTHH:mm:ssZ` — strip milliseconds (TM rejects them) and
// force a UTC `Z` so the cutoff is unambiguous.
function nowIsoForApi() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatDate(localDate, localTime) {
  if (!localDate) return '';
  // localDate is "YYYY-MM-DD"; localTime is "HH:MM:SS". Combine for a Date and
  // format into "Mon, D MMM" style resembling existing mockEvents.
  const d = new Date(`${localDate}T${(localTime || '00:00:00').slice(0, 5)}`);
  if (Number.isNaN(d.getTime())) return localDate;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// Returns an ISO timestamp so downstream sorting and "is this event past"
// pruning can rely on it. The display-friendly `date` field stays the
// localized short string above.
function getStartAt(startObj) {
  if (!startObj) return null;
  if (startObj.dateTime) {
    const t = Date.parse(startObj.dateTime);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  if (startObj.localDate) {
    const localTime = (startObj.localTime || '00:00:00').slice(0, 5);
    const t = Date.parse(`${startObj.localDate}T${localTime}`);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

function formatPrice(priceRanges) {
  if (!priceRanges?.length) return 'See ticket';
  const [r] = priceRanges;
  const fmt = (n) =>
    Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
  if (r.min === r.max) return fmt(r.min);
  return `${fmt(r.min)} – ${fmt(r.max)}`;
}

function normalize(ev) {
  const venue = ev._embedded?.venues?.[0];
  const location = venue
    ? [venue.name, venue.city?.name].filter(Boolean).join(', ')
    : 'Austin, TX';

  return {
    id: `tm-${ev.id}`,
    title: ev.name || 'Untitled event',
    date: formatDate(ev.dates?.start?.localDate, ev.dates?.start?.localTime),
    startAt: getStartAt(ev.dates?.start),
    location,
    price: formatPrice(ev.priceRanges),
    category: mapCategory(ev.classifications),
    image:
      ev.images?.find((i) => i.ratio === '16_9' && i.width >= 640)?.url ||
      ev.images?.[0]?.url ||
      '',
    url: ev.url || '',
    source: 'Ticketmaster',
    description: truncate(ev.info || ev.pleaseNote || '', 240),
  };
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export async function fetchTicketmasterEvents({ apiKey, signal } = {}) {
  if (!apiKey) {
    throw new Error(
      'Missing VITE_TICKETMASTER_KEY. Add a Ticketmaster Discovery API key to .env.local to enable live events.',
    );
  }
  const params = new URLSearchParams({
    apikey: apiKey,
    city: 'Austin',
    stateCode: 'TX',
    countryCode: 'US',
    size: '40',
    sort: 'date,asc',
    includeTest: 'no',
    // Only events starting from "now" onward. TM requires this exact format
    // (no millisecond precision, must end in `Z`); builds prevent drift.
    startDateTime: nowIsoForApi(),
  });
  const url = `${ENDPOINT}?${params.toString()}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Ticketmaster request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const rawEvents = data?._embedded?.events || [];
  return rawEvents.filter(isRealEvent).map(normalize);
}

export const ticketmasterMeta = {
  id: 'ticketmaster',
  label: 'Ticketmaster Discovery API',
  requiresKey: true,
};

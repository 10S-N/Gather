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

// Category hints we lift onto our own dropdown taxonomy.
const CATEGORY_MAP = [
  { match: ['music'], category: 'Entertainment' },
  { match: ['sports'], category: 'Community' },
  { match: ['family'], category: 'Social' },
  { match: ['arts', 'theatre', 'theater'], category: 'Entertainment' },
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
  });
  const url = `${ENDPOINT}?${params.toString()}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Ticketmaster request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const events = data?._embedded?.events || [];
  return events.map(normalize);
}

export const ticketmasterMeta = {
  id: 'ticketmaster',
  label: 'Ticketmaster Discovery API',
  requiresKey: true,
};

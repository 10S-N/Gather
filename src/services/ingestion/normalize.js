// Turns a source-specific raw event into the exact document shape Gather stores
// in Firestore (see src/services/events.js for the schema). Everything that
// decides "does this belong on the board?" lives here, so every adapter inherits
// the same quality bar.

import { inferCategory, inferNeighborhood, inferTags } from './taxonomy.js';
import { parseDateValue } from './time.js';
import { safeDocId, stableHash, stripHtml, truncate } from './text.js';

export const CURATED_ORIGIN = 'curated';
export const CURATED_HOST_UID = 'gather:curated';
const DEFAULT_LOOKAHEAD_DAYS = 120;
const PAST_GRACE_MS = 6 * 60 * 60 * 1000;
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 4000;

// Canonical raw event shape adapters should return:
//   {
//     externalId, title, description, startAt, endAt, url, imageUrl,
//     venueName, address, city, lat, lng, price, externalCategory, tags[]
//   }
export function normalizeIngestedEvent(
  raw,
  source,
  { now = new Date(), lookaheadDays = DEFAULT_LOOKAHEAD_DAYS, timeZone } = {},
) {
  const problems = [];
  const externalId = String(raw?.externalId ?? '').trim();
  if (!externalId) problems.push('missing external id');

  const title = truncate(stripHtml(raw?.title || ''), MAX_TITLE);
  if (title.length < 3) problems.push('title too short');

  const startAt = parseDateValue(raw?.startAt, { timeZone });
  const endAt = parseDateValue(raw?.endAt, { timeZone });
  if (!startAt) problems.push('unparseable start date');

  if (startAt) {
    // A multi-day listing (a festival, a run of shows) is still current when its
    // start has passed but its end has not, so judge by the later of the two.
    const endsAt = endAt && endAt > startAt ? endAt : new Date(startAt.getTime() + PAST_GRACE_MS);
    if (endsAt.getTime() < now.getTime()) problems.push('event already ended');
    if (startAt.getTime() > now.getTime() + lookaheadDays * 86_400_000) {
      problems.push('event is beyond the sync window');
    }
  }

  const sourceUrl = safeUrl(raw?.url);
  if (raw?.url && !sourceUrl) problems.push('source link is not http(s)');

  if (problems.length) {
    return { ok: false, reason: problems.join('; '), externalId, title };
  }

  const descriptionHtml = raw?.description || '';
  const description = truncate(stripHtml(descriptionHtml), MAX_DESCRIPTION);
  const address = truncate(String(raw?.address || raw?.venueName || '').trim(), 160);
  const venue = String(raw?.venueName || '').trim();

  const { neighborhood } = inferNeighborhood({
    address,
    venue,
    title,
    description,
    lat: raw?.lat,
    lng: raw?.lng,
  });

  const { category } = inferCategory({
    title,
    description,
    tags: raw?.tags,
    externalCategory: raw?.externalCategory,
  });

  const tags = inferTags({ title, description, tags: raw?.tags });
  const docId = `${source.id}_${safeDocId(stableHash(`${source.id}:${externalId}`))}`;

  return {
    ok: true,
    doc: {
      id: docId,
      title,
      description: description || `Imported from ${source.label}. See the original listing for full details.`,
      category,
      tags,
      neighborhood,
      address: address || venue || 'Austin, TX',
      startAt,
      endAt: endAt && endAt > startAt ? endAt : null,
      // Date-only listings (all-day volunteer days, some iCal feeds) have no
      // real start time; storing midnight is fine, but the UI must not claim
      // the event starts at 12:00 AM.
      timeTba: Boolean(raw?.timeTba),
      imageUrl: safeUrl(raw?.imageUrl) || '',
      rsvpUrl: safeUrl(raw?.rsvpUrl) || '',
      price: normalizePrice(raw?.price),
      capacity: null,
      attendeeCount: 0,
      // Curated rows are written with the Admin SDK, and this uid never belongs
      // to a real account, so no client can ever claim or edit them.
      hostUid: CURATED_HOST_UID,
      hostName: source.label,
      hostPhotoURL: '',
      origin: CURATED_ORIGIN,
      source: source.id,
      sourceLabel: source.label,
      externalId,
      sourceUrl,
    },
  };
}

function safeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizePrice(value) {
  if (value == null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value <= 0 ? 'Free' : `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
  }
  const text = String(value).trim();
  if (!text) return '';
  if (/^free$/i.test(text) || text === '$0') return 'Free';
  return truncate(text, 40);
}

// Fields compared when deciding whether an existing row actually needs a write.
export const SYNCED_FIELDS = [
  'title',
  'description',
  'category',
  'tags',
  'neighborhood',
  'address',
  'startAt',
  'endAt',
  'timeTba',
  'imageUrl',
  'price',
  'sourceUrl',
  'sourceLabel',
  'hostName',
];

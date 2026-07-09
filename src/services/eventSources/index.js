import { fetchTicketmasterEvents, ticketmasterMeta } from './ticketmaster';

// Registry of live event sources. Each source is enabled iff it has the
// configuration it needs (e.g. API keys). Adding a new source is a 3-step
// pattern: write the adapter file, import it here, add its meta to SOURCES.
export const SOURCES = [ticketmasterMeta];

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_KEY = 'gather:liveEvents:v1';

// Cheap, dedupe-tolerant fingerprint: normalized title + start date + venue.
// Used to collapse the same event coming through multiple sources OR repeat
// cache hits.
function fingerprint(ev) {
  const t = (ev.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const d = (ev.date || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const v = (ev.location || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${t}::${d}::${v}`;
}

// Drops events whose startAt falls more than ~6 hours in the past so the
// cache doesn't show events that already happened. Events without a reliable
// startAt (e.g. unparseable display strings) are kept as a fallback.
function prunePast(events, now = Date.now()) {
  return events.filter((ev) => {
    if (ev.startAt) {
      const t = Date.parse(ev.startAt);
      if (!Number.isNaN(t)) return t + 6 * 60 * 60 * 1000 > now;
    }
    // No trustworthy timestamp — keep the event; mockEvents and partially-formed
    // listings will rely on display-string sorting in the UI.
    return true;
  });
}

export function dedupeEvents(events) {
  const seen = new Map();
  for (const ev of events) {
    const key = fingerprint(ev);
    if (!seen.has(key)) seen.set(key, ev);
  }
  return Array.from(seen.values());
}

export function readCache() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.fetchedAt || !Array.isArray(parsed.events)) return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache(events, sourcesActive) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        fetchedAt: Date.now(),
        sourcesActive,
        events,
      }),
    );
  } catch {
    // localStorage may be unavailable in private mode; ignore.
  }
}

export function clearCache() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

// Pulls fresh events from every enabled source in parallel. Failures of one
// source don't kill the others; we collect what we can and report per-source
// status in the returned `report`.
export async function fetchLiveEvents({ sources = SOURCES, signal } = {}) {
  const results = await Promise.allSettled(
    sources.map((src) => {
      if (src.id === 'ticketmaster') {
        return fetchTicketmasterEvents({
          apiKey: import.meta.env.VITE_TICKETMASTER_KEY,
          signal,
        });
      }
      return Promise.reject(new Error(`Unknown source: ${src.id}`));
    }),
  );

  const events = [];
  const report = [];
  results.forEach((r, i) => {
    const meta = sources[i];
    if (r.status === 'fulfilled') {
      events.push(...r.value);
      report.push({ id: meta.id, label: meta.label, ok: true, count: r.value.length });
    } else {
      // Never surface raw API keys; strip any ?apikey= query string from the message.
      const msg = (r.reason?.message || String(r.reason)).replace(/apikey=[^&\s]+/gi, 'apikey=REDACTED');
      report.push({ id: meta.id, label: meta.label, ok: false, error: msg });
    }
  });

  const deduped = dedupeEvents(prunePast(events));
  const sourcesActive = report.filter((r) => r.ok).map((r) => r.label);
  writeCache(deduped, sourcesActive);
  return { events: deduped, report, sourcesActive };
}

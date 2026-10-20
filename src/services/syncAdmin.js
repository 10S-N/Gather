// Browser-side helpers for the /admin/sync view.
//
// Two ways to run the pipeline:
//   1. runBrowserSync() — executes it *here*, in the signed-in admin's browser,
//      writing through the client SDK. No service account, no serverless host.
//      Security is enforced by firestore.rules (curated writes are admin-only).
//   2. triggerSync() — POSTs to a deployed api/sync handler when you have one.
//
// Both call the same runSync() orchestrator, so dedupe and normalization are
// identical. Feeds are not CORS-friendly, so in dev a Vite middleware proxies
// them (see the ingestionFetchProxy plugin in vite.config.js).

import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { isSyncAdmin } from '../utils/admin';
import { createClientStore } from './ingestion/clientStore.js';
import { describeSources, getSources, runSync } from './ingestion/index.js';

export { adminUids, isSyncAdmin } from '../utils/admin';


export const SYNC_ENDPOINT = import.meta.env.VITE_SYNC_ENDPOINT || '/api/sync';

// Dev-only fetch proxy (same-origin, so no CORS preflight). Empty in a
// production build; adapters then fetch directly and Eventbrite/Luma will be
// rejected by CORS unless you deploy the serverless handler instead.
export const INGEST_PROXY = import.meta.env.DEV ? '/__ingest' : '';

// Ingestion env for a browser run. VITE_-prefixed values cover the long-lived
// settings; the admin page passes per-run overrides (an Eventbrite token typed
// into the form is never bundled or persisted).
export function browserSyncEnv(overrides = {}) {
  const vite = import.meta.env;
  return {
    // VITE_EVENTBRITE_API_TOKEN is the older name; keep reading it so existing
    // .env.local files keep working.
    EVENTBRITE_API_KEY: vite.VITE_EVENTBRITE_API_KEY || vite.VITE_EVENTBRITE_API_TOKEN || '',
    EVENTBRITE_ORGANIZERS: vite.VITE_EVENTBRITE_ORGANIZERS || '',
    EVENTBRITE_CATEGORIES: vite.VITE_EVENTBRITE_CATEGORIES || '',
    EVENTBRITE_MAX_EVENTS: vite.VITE_EVENTBRITE_MAX_EVENTS || '',
    LUMA_CALENDARS: vite.VITE_LUMA_CALENDARS || '',
    RSS_FEEDS: vite.VITE_RSS_FEEDS || '',
    SYNC_FIXTURES: vite.VITE_SYNC_FIXTURES || '',
    ...overrides,
  };
}

// Source catalog with this browser's current configuration flags, so the admin
// page can show which adapters will actually run.
export function describeBrowserSources(overrides = {}) {
  return describeSources(browserSyncEnv(overrides));
}

// Rewrites absolute feed URLs through the dev proxy. Headers the browser is not
// allowed to set (user-agent) are dropped; the proxy adds its own.
function proxiedFetch(proxyPath) {
  return (input, init = {}) => {
    const target = typeof input === 'string' ? input : input?.url;
    if (!proxyPath || !target || !/^https?:\/\//i.test(target)) return fetch(input, init);

    const headers = new Headers(init.headers || {});
    headers.delete('user-agent');
    return fetch(`${proxyPath}?url=${encodeURIComponent(target)}`, { ...init, headers });
  };
}

function requireAdmin() {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in with an ingestion admin account first.');
  if (!isSyncAdmin(user)) {
    throw new Error(
      `This account (${user.email || user.uid}) is not an ingestion admin. Run "npm run admin:grant -- ${user.uid}" in the project root, redeploy firestore.rules, then restart the dev server.`,
    );
  }
  return user;
}

// Runs the sync with the client SDK and writes straight to Firestore. Throws
// with an actionable message instead of returning an empty report when nothing
// is configured, so the button never looks like it silently did nothing.
export async function runBrowserSync({
  dryRun = false,
  prune = false,
  env = {},
  only = [],
  exclude = [],
} = {}) {
  const user = requireAdmin();
  const resolvedEnv = browserSyncEnv(env);
  const sources = getSources(resolvedEnv, { only, exclude });

  if (!sources.length) {
    throw new Error(
      'No ingestion source is configured for this run. Paste an Eventbrite API key, add a Luma calendar or RSS feed, tick “Fetch live Eventbrite events”, or tick “Include demo events”.',
    );
  }

  return runSync({
    sources,
    store: createClientStore({ db, uid: user.uid }),
    env: resolvedEnv,
    dryRun,
    pruneExpired: prune,
    trigger: dryRun ? 'browser-preview' : 'browser',
    fetchImpl: proxiedFetch(INGEST_PROXY),
  });
}

// Deletes the curated rows produced by the demo fixture adapter. Only curated
// rows from that source are touched, so real imports and neighbor posts stay.
export async function deleteDemoEvents({ source = 'fixture' } = {}) {
  requireAdmin();

  const snap = await getDocs(query(collection(db, 'events'), where('source', '==', source)));
  const refs = snap.docs
    .filter((entry) => entry.data()?.origin === 'curated')
    .map((entry) => entry.ref);

  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }

  return refs.length;
}

export function subscribeSyncRuns(onRuns, onError, limitCount = 12) {
  const q = query(collection(db, 'syncRuns'), orderBy('startedAt', 'desc'), limit(limitCount));
  return onSnapshot(
    q,
    (snap) => onRuns(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))),
    (err) => onError?.(err),
  );
}

export async function triggerSync({ dryRun = false, sources = [] } = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in with an ingestion admin account first.');

  const token = await user.getIdToken();
  let res;
  try {
    res = await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dryRun, sources }),
    });
  } catch {
    throw new Error(
      `Could not reach ${SYNC_ENDPOINT}. Run the sync from your terminal instead: npm run sync:events`,
    );
  }

  const payload = await res.json().catch(() => ({}));

  if (res.status === 404) {
    throw new Error(
      `No sync endpoint at ${SYNC_ENDPOINT}. Deploy the api/sync handler (Vercel) or run npm run sync:events from your terminal.`,
    );
  }
  if (!res.ok || payload.ok === false) {
    throw new Error(payload.error || `Sync endpoint returned ${res.status}.`);
  }
  return payload.run;
}

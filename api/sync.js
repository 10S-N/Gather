// Serverless entry point for the ingestion pipeline (Vercel-style `api/`).
//
//   POST /api/sync
//   body: { "dryRun": false, "sources": ["luma"] }   // both optional
//
// Two ways to authenticate:
//   1. a signed-in Gather admin — Authorization: Bearer <firebase-id-token>,
//      uid (or email) listed in ADMIN_UIDS / ADMIN_EMAILS
//   2. a scheduler — x-sync-secret: <SYNC_SECRET>
//
// This is what the "Run sync now" button on /admin/sync calls. It reuses the
// exact same orchestrator as `npm run sync:events`.

import { getAuth } from 'firebase-admin/auth';
import { createFirestoreStore, initAdminApp } from '../server/ingestionStore.js';
import { getSources, runSync } from '../src/services/ingestion/index.js';

function splitEnv(value) {
  return String(value || '')
    .split(/[,\s;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function bearerToken(req) {
  const header = req.headers?.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function authorize(req) {
  const secret = process.env.SYNC_SECRET;
  const provided = req.headers?.['x-sync-secret'];
  if (secret && provided && provided === secret) {
    return { ok: true, actor: 'scheduler' };
  }

  const token = bearerToken(req);
  if (!token) return { ok: false, error: 'Missing bearer token.' };

  const adminUids = splitEnv(process.env.ADMIN_UIDS);
  const adminEmails = splitEnv(process.env.ADMIN_EMAILS).map((email) => email.toLowerCase());
  if (!adminUids.length && !adminEmails.length) {
    return {
      ok: false,
      error: 'Endpoint is locked: set ADMIN_UIDS (or ADMIN_EMAILS) to allow admin-triggered syncs.',
    };
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch {
    return { ok: false, error: 'Invalid or expired session token.' };
  }

  const uidAllowed = adminUids.includes(decoded.uid);
  const emailAllowed = decoded.email && adminEmails.includes(decoded.email.toLowerCase());
  if (!uidAllowed && !emailAllowed) {
    return { ok: false, error: 'This account is not an ingestion admin.' };
  }

  return { ok: true, actor: decoded.uid };
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Use POST to trigger a sync.' });
    return;
  }

  try {
    initAdminApp(process.env);
  } catch (err) {
    res.status(500).json({ ok: false, error: `Firebase Admin init failed: ${err.message}` });
    return;
  }

  const auth = await authorize(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, error: auth.error });
    return;
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const only = Array.isArray(body.sources) ? body.sources.filter((id) => typeof id === 'string') : [];
  const sources = getSources(process.env, { only });

  if (!sources.length) {
    res.status(400).json({
      ok: false,
      error:
        'No ingestion sources are configured. Do512 and the built-in community calendars need no setup, so every source was probably excluded by the request.',
    });
    return;
  }

  try {
    const run = await runSync({
      sources,
      store: createFirestoreStore(),
      env: process.env,
      dryRun: Boolean(body.dryRun),
      pruneExpired: Boolean(body.prune),
      trigger: auth.actor === 'scheduler' ? 'scheduler' : 'admin',
    });
    res.status(200).json({ ok: true, run });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Sync failed.' });
  }
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

// Server-only Firestore implementation of the sync store contract.
//
// This file is imported by `scripts/sync-events.mjs` and `api/sync.js`, never by
// the React app. The Admin SDK bypasses security rules, which is what lets the
// sync write curated rows that no browser session could create (they carry
// hostUid "gather:curated" and an `origin` of "curated").

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const EVENTS = 'events';
const RUNS = 'syncRuns';
const BATCH_LIMIT = 400; // Firestore hard limit is 500; leave headroom.
const LOAD_LIMIT = 3000;

export function initAdminApp(env = process.env) {
  if (getApps().length) return getApps()[0];

  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT must be the service-account JSON itself, not a path.');
    }
    return initializeApp({ credential: cert(parsed) });
  }

  // GOOGLE_APPLICATION_CREDENTIALS (a file path) or the ambient workload
  // identity is picked up by applicationDefault().
  return initializeApp({ credential: applicationDefault() });
}

function toTimestamp(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  return Timestamp.fromDate(value instanceof Date ? value : new Date(value));
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rowFromDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    startAt: toDate(data.startAt),
    endAt: toDate(data.endAt),
  };
}

function documentFromPlan(doc, now) {
  return {
    ...doc,
    startAt: toTimestamp(doc.startAt),
    endAt: toTimestamp(doc.endAt),
    syncedAt: toTimestamp(now),
    updatedAt: toTimestamp(now),
  };
}

export function createFirestoreStore({ db = getFirestore(), collectionName = EVENTS, runsCollection = RUNS } = {}) {
  return {
    // Loads upcoming events once. Curated rows are matched by external id;
    // community rows are kept so the planner can refuse to shadow a hand-posted
    // event. A single range query on startAt uses Firestore's automatic index.
    async loadExisting({ now = new Date() } = {}) {
      const windowStart = new Date(now.getTime() - 14 * 86_400_000);
      const snap = await db
        .collection(collectionName)
        .where('startAt', '>=', Timestamp.fromDate(windowStart))
        .orderBy('startAt', 'asc')
        .limit(LOAD_LIMIT)
        .get();
      return snap.docs.map(rowFromDoc);
    },

    async commit({ creates = [], updates = [], expired = [], now = new Date() }) {
      const ops = [
        ...creates.map((item) => ({ type: 'create', id: item.id, doc: item.doc })),
        ...updates.map((item) => ({ type: 'update', id: item.id, patch: item.patch })),
        ...expired.map((item) => ({ type: 'expire', id: item.id })),
      ];

      let batches = 0;
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const chunk = ops.slice(i, i + BATCH_LIMIT);
        const batch = db.batch();
        for (const op of chunk) {
          const ref = db.collection(collectionName).doc(op.id);
          if (op.type === 'create') {
            batch.set(ref, documentFromPlan(op.doc, now));
          } else if (op.type === 'update') {
            batch.set(ref, { ...op.patch, syncedAt: toTimestamp(now), updatedAt: toTimestamp(now) }, { merge: true });
          } else {
            batch.delete(ref);
          }
        }
        await batch.commit();
        batches += 1;
      }

      return {
        created: creates.length,
        updated: updates.length,
        expired: expired.length,
        batches,
      };
    },

    async recordRun(run) {
      const ref = await db.collection(runsCollection).add({
        ...run,
        startedAt: toTimestamp(run.startedAt),
        finishedAt: toTimestamp(run.finishedAt),
        recordedAt: Timestamp.now(),
      });
      return ref.id;
    },
  };
}

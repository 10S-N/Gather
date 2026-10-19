// Firestore implementation of the sync store contract for *browser* runs.
//
// Same contract as server/ingestionStore.js, but built on the client SDK and
// the signed-in user's session, so no service-account key is needed:
//
//   loadExisting({ activeSourceIds, now }) -> existingRow[]
//   commit({ creates, updates, expired, now }) -> { created, updated, expired, batches }
//   recordRun(run) -> runId
//
// Security lives in firestore.rules: only ingestion admins may create or
// mutate rows with origin == 'curated', and only for the curated host uid.
// Nothing here is trusted — the rules re-check every write.

import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';

const EVENTS = 'events';
const RUNS = 'syncRuns';
const BATCH_LIMIT = 400; // Firestore hard limit is 500; leave headroom.
const LOAD_LIMIT = 3000;

export function toTimestamp(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  return Timestamp.fromDate(value instanceof Date ? value : new Date(value));
}

export function toDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function rowFromSnapshot(snapshot) {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    ...data,
    startAt: toDateValue(data.startAt),
    endAt: toDateValue(data.endAt),
  };
}

export function documentFromPlan(docData, now) {
  return {
    ...docData,
    startAt: toTimestamp(docData.startAt),
    endAt: toTimestamp(docData.endAt),
    syncedAt: toTimestamp(now),
    updatedAt: toTimestamp(now),
  };
}

export function createClientStore({
  db,
  uid = '',
  collectionName = EVENTS,
  runsCollection = RUNS,
} = {}) {
  if (!db) throw new Error('createClientStore requires a Firestore instance');

  return {
    // One range query on startAt keeps the planner honest without needing a
    // composite index: everything from two weeks ago onwards.
    async loadExisting({ now = new Date() } = {}) {
      const windowStart = new Date(now.getTime() - 14 * 86_400_000);
      const snap = await getDocs(
        query(
          collection(db, collectionName),
          where('startAt', '>=', toTimestamp(windowStart)),
          orderBy('startAt', 'asc'),
          limit(LOAD_LIMIT),
        ),
      );
      return snap.docs.map(rowFromSnapshot);
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
        const batch = writeBatch(db);
        for (const op of chunk) {
          const ref = doc(db, collectionName, op.id);
          if (op.type === 'create') {
            batch.set(ref, documentFromPlan(op.doc, now));
          } else if (op.type === 'update') {
            // Merge so host-side community fields are never clobbered; the
            // planner only produces patches for curated rows it matched.
            batch.set(
              ref,
              { ...op.patch, syncedAt: toTimestamp(now), updatedAt: toTimestamp(now) },
              { merge: true },
            );
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
      const ref = await addDoc(collection(db, runsCollection), {
        ...run,
        trigger: run.trigger || 'browser',
        triggeredBy: uid || '',
        startedAt: toTimestamp(run.startedAt),
        finishedAt: toTimestamp(run.finishedAt),
        recordedAt: Timestamp.now(),
      });
      return ref.id;
    },
  };
}

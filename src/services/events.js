import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';

// Firestore access for the community-owned event board.
//
//   events/{eventId}
//     title, description, category, tags[], neighborhood, address,
//     startAt (Timestamp), endAt (Timestamp|null), imageUrl, rsvpUrl,
//     price, capacity, attendeeCount, hostUid, hostName, hostPhotoURL,
//     createdAt, updatedAt
//
// Reads are public (anyone can browse); writes are restricted to the host by
// firestore.rules.

export const eventsCollection = () => collection(db, 'events');

export const makeTimestamp = (date) => Timestamp.fromDate(date);

// Ordered, live feed. Sorting server-side keeps the client from re-sorting
// every snapshot; Firestore handles this with the automatic single-field
// index on startAt.
export function subscribeCommunityEvents(onRows, onError) {
  const q = query(eventsCollection(), orderBy('startAt', 'asc'));
  return onSnapshot(
    q,
    (snap) => onRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError?.(err),
  );
}

// Hosts' own events. No orderBy here on purpose: combining an equality filter
// with an orderBy would require a composite index, so we sort in the hook.
export function subscribeHostedEvents(uid, onRows, onError) {
  if (!uid) return () => {};
  const q = query(eventsCollection(), where('hostUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => onRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError?.(err),
  );
}

export function subscribeEvent(eventId, onRow, onError) {
  if (!eventId) return () => {};
  return onSnapshot(
    doc(db, 'events', eventId),
    (snap) => onRow(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (err) => onError?.(err),
  );
}

export async function getEventRow(eventId) {
  const snap = await getDoc(doc(db, 'events', eventId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Batches documentId() lookups in groups of 10 (Firestore's `in` limit).
export async function fetchEventsByIds(ids) {
  const unique = [...new Set(ids)].filter(Boolean);
  const chunks = [];
  for (let i = 0; i < unique.length; i += 10) chunks.push(unique.slice(i, i + 10));

  const results = await Promise.all(
    chunks.map((chunk) =>
      getDocs(query(eventsCollection(), where(documentId(), 'in', chunk))),
    ),
  );

  const rows = [];
  for (const snap of results) {
    for (const d of snap.docs) rows.push({ id: d.id, ...d.data() });
  }
  return rows;
}

export async function createEvent(payload, user) {
  const ref = await addDoc(eventsCollection(), {
    ...payload,
    hostUid: user.uid,
    hostName: user.displayName || user.email?.split('@')[0] || 'A neighbor',
    hostPhotoURL: user.photoURL || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateEvent(eventId, payload) {
  await updateDoc(doc(db, 'events', eventId), {
    ...payload,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteEvent(eventId) {
  await deleteDoc(doc(db, 'events', eventId));
}

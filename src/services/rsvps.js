import {
  collection,
  doc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

// RSVPs live in a top-level collection keyed by `<eventId>__<uid>`.
//
// Why not a subcollection? Querying "everything this user RSVP'd to" across
// subcollections needs a collection-group index. A flat collection keeps the
// lookup to a single automatic index (uid == me) and makes the membership
// document idempotent, so double clicks can't create duplicates.
//
//   rsvps/{eventId__uid}
//     eventId, uid, displayName, photoURL, createdAt

const rsvpsCollection = () => collection(db, 'rsvps');

export const rsvpId = (eventId, uid) => `${eventId}__${uid}`;

export function subscribeMyRsvps(uid, onChange, onError) {
  if (!uid) return () => {};
  const q = query(rsvpsCollection(), where('uid', '==', uid));
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError?.(err),
  );
}

// Joins/leaves an event atomically: the membership doc and the denormalized
// attendeeCount on the event move together, so counts never drift.
export async function toggleRsvp({ eventId, user, joining }) {
  if (!user) throw new Error('Sign in to RSVP.');
  if (!eventId) throw new Error('Missing event.');

  const batch = writeBatch(db);
  const membershipRef = doc(db, 'rsvps', rsvpId(eventId, user.uid));
  const eventRef = doc(db, 'events', eventId);

  if (joining) {
    batch.set(membershipRef, {
      eventId,
      uid: user.uid,
      displayName: user.displayName || user.email?.split('@')[0] || 'A neighbor',
      photoURL: user.photoURL || '',
      createdAt: serverTimestamp(),
    });
    batch.update(eventRef, {
      attendeeCount: increment(1),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.delete(membershipRef);
    batch.update(eventRef, {
      attendeeCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

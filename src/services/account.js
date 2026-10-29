import { EmailAuthProvider, deleteUser, reauthenticateWithCredential } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { toggleRsvp } from './rsvps';

// Deleting an account touches three things, in an order that only removes data
// once the sign-in has been re-confirmed:
//
//   1. reauthenticate   (Firebase refuses a delete on a stale session)
//   2. rsvps + users/*  (rules let a user delete their own membership + profile)
//   3. the auth user    (last: after this the client can no longer write)
//
// Events the person hosted are left on the board on purpose — other neighbours
// have RSVP'd to them — but that is spelled out in the UI before it happens.

export function hasPasswordSignIn(user) {
  return Boolean(user?.providerData?.some((provider) => provider.providerId === 'password'));
}

async function reauthenticate(user, password) {
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
}

// Leaves every event they RSVP'd to (so `attendeeCount` stays honest) and drops
// their profile doc, which holds the cover photo and the feed picks.
export async function deleteAccountData(user) {
  const snapshot = await getDocs(query(collection(db, 'rsvps'), where('uid', '==', user.uid)));

  for (const row of snapshot.docs) {
    try {
      await toggleRsvp({ eventId: row.data().eventId, user, joining: false });
    } catch {
      // The event itself is gone; drop the leftover membership doc instead of
      // failing the whole deletion.
      await deleteDoc(doc(db, 'rsvps', row.id));
    }
  }

  await deleteDoc(doc(db, 'users', user.uid));
}

export async function deleteAccount(user, password) {
  const current = auth.currentUser;
  if (!current || current.uid !== user.uid) throw new Error('You are already signed out.');

  if (hasPasswordSignIn(current)) await reauthenticate(current, password);

  await deleteAccountData(current);
  await deleteUser(current);
}

import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

// Path to a public profile document keyed by Firebase Auth uid.
const userDocRef = (uid) => doc(db, 'users', uid);

// Subscribes to the user's profile doc. Returns an unsubscribe function.
// `profile` shape: { coverPhotoURL: string | null, displayName: string | null, updatedAt: Timestamp | null }
export function subscribeUserProfile(uid, onChange) {
  return onSnapshot(
    userDocRef(uid),
    (snap) => {
      onChange(snap.exists() ? snap.data() : null);
    },
    (err) => {
      // Surface the error to the caller instead of swallowing it; the UI
      // can decide whether to retry or hide the cover banner.
      onChange(null, err);
    },
  );
}

export async function getUserProfile(uid) {
  const snap = await getDoc(userDocRef(uid));
  return snap.exists() ? snap.data() : null;
}

// Upserts a partial profile (merge=true). Always stamps updatedAt server-side.
export async function updateUserProfile(uid, patch) {
  await setDoc(
    userDocRef(uid),
    { ...patch, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
